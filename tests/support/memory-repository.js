// TEST DOUBLE ONLY. Production imports only the Mongoose repository.
import {randomUUID} from 'node:crypto';
import {nextDates,today} from '../../server/src/domain/validation.js';
import {fail} from '../../server/src/domain/errors.js';
const copy=x=>structuredClone(x);
function get(o,key){return key.split('.').reduce((a,k)=>a?.[k],o);}
function matches(o,q){return Object.entries(q).every(([key,want])=>{
  if(key==='$or')return want.some(x=>matches(o,x));if(key==='$and')return want.every(x=>matches(o,x));
  const actual=get(o,key),same=v=>v===null?actual==null:Array.isArray(actual)?actual.includes(v):actual===v;
  if(want&&typeof want==='object'&&!Array.isArray(want))return Object.entries(want).every(([op,v])=>{
    if(op==='$ne')return !same(v);if(op==='$in')return v.some(same);if(op==='$gt')return actual>v;if(op==='$gte')return actual>=v;if(op==='$lt')return actual<v;if(op==='$lte')return actual<=v;if(op==='$options')return true;if(op==='$regex')return new RegExp(v,want.$options).test(Array.isArray(actual)?actual.join(' '):actual||'');throw new Error('Unsupported test query '+op);
  });return same(want);
});}
export class MemoryRepository{
  constructor({clock=()=>new Date(),data=new Map(),transactional=false}={}){this.clock=clock;this.data=data;this.transactional=transactional;this.tail=Promise.resolve();}
  coll(n){if(!this.data.has(n))this.data.set(n,new Map());return this.data.get(n);}
  async transaction(fn){if(this.transactional)return fn(this);const previous=this.tail;let release;this.tail=new Promise(r=>release=r);await previous;const tx=new MemoryRepository({clock:this.clock,data:copy(this.data),transactional:true});try{const result=await fn(tx);this.data=tx.data;return result;}finally{release();}}
  async get(n,id){return copy(this.coll(n).get(id)||null);}
  async findOne(n,q){return copy([...this.coll(n).values()].find(x=>matches(x,q))||null);}
  async list(n,q={},options={}){const {limit=25,skip=0,sort={createdAt:-1,id:-1}}=options;const rows=[...this.coll(n).values()].filter(x=>matches(x,q)).sort((a,b)=>{for(const[k,dir]of Object.entries(sort)){if(get(a,k)!==get(b,k))return (get(a,k)>get(b,k)?1:-1)*dir;}return 0;});return copy(rows.slice(skip,limit===0?undefined:skip+limit));}
  async count(n,q={}){return [...this.coll(n).values()].filter(x=>matches(x,q)).length;}
  async insert(n,value){const record={id:randomUUID(),version:0,createdAt:this.clock().toISOString(),updatedAt:this.clock().toISOString(),...copy(value)};if(this.coll(n).has(record.id))throw Object.assign(new Error('duplicate'),{code:11000});this.coll(n).set(record.id,record);return copy(record);}
  async save(n,value){const old=this.coll(n).get(value.id);if(!old||old.version!==value.version)fail(409,'STALE_VERSION','Stale record');const saved={...copy(value),version:value.version+1,updatedAt:this.clock().toISOString()};this.coll(n).set(value.id,saved);return copy(saved);}
  async updateMany(n,q,changes){for(const row of [...this.coll(n).values()].filter(x=>matches(x,q))){const r=copy(row);for(const[k,v]of Object.entries(changes)){const keys=k.split('.');let node=r;for(const part of keys.slice(0,-1))node=node[part]??={};node[keys.at(-1)]=v;}await this.save(n,r);}}
  async removeWhere(n,q){for(const row of [...this.coll(n).values()].filter(x=>matches(x,q)))this.coll(n).delete(row.id);}
  async fence(n,id){if(!this.coll(n).has(id))fail(409,'STALE_VERSION','Missing record');}
  searchMatch(record,query,pattern){
    if(!pattern)return matches(record,query);
    const {$or=[],...base}=query,c=this.coll('companies').get(record.companyId),re=new RegExp(pattern,'i');
    return matches(record,base)&&($or.some(q=>matches(record,q))||re.test(c?.name||'')||(c?.aliases||[]).some(n=>re.test(n)));
  }
  async companySearchPage(name,query,{page=1,limit=25,companySearch=''}){
    const all=[...this.coll(name).values()].filter(r=>this.searchMatch(r,query,companySearch)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    return {items:copy(all.slice((page-1)*limit,page*limit)),total:all.length};
  }
  async labourPage(query,{page=1,limit=25,status,upcoming=false,now=new Date(),companySearch=''}={}){
    const computed=[...this.coll('labour').values()].filter(r=>this.searchMatch(r,query,companySearch)).map(r=>{
      const date=nextDates(r,1,today(r.site?.zone,now))[0],count=r.fills?.[date||r.start]||0;
      const phase=r.phase==='cancelled'?'cancelled':r.phase==='info'?'info':count>=r.headcount&&r.headcount>0?'filled':count>0||['staffing','filled'].includes(r.phase)?'staffing':'new';
      return {r,date,phase};
    }).filter(x=>(!status||status==='all'||x.phase===status)&&(!upcoming||(x.date&&x.r.phase!=='cancelled'))).sort((a,b)=>upcoming?(a.date.localeCompare(b.date)||b.r.createdAt.localeCompare(a.r.createdAt)):(b.r.createdAt.localeCompare(a.r.createdAt)||b.r.id.localeCompare(a.r.id)));
    return {items:copy(computed.slice((page-1)*limit,page*limit).map(x=>x.r)),total:computed.length};
  }
  async nextSequence(n){let c=await this.get('counters',n);if(!c)c=await this.insert('counters',{id:n,value:1000});c.value++;await this.save('counters',c);return c.value;}
}
