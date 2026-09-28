import mongoose from 'mongoose';
import {randomUUID} from 'node:crypto';
import {models} from '../models/index.js';
import {labourPipeline,companySearchStages} from './labour-pipeline.js';
import {fail} from '../domain/errors.js';
const encodeQuery=q=>{
  if(Array.isArray(q))return q.map(encodeQuery);
  if(q&&typeof q==='object'&&!(q instanceof Date))return Object.fromEntries(Object.entries(q).map(([k,v])=>[k==='id'?'_id':k,encodeQuery(v)]));
  return q;
};
function plain(value,document=true){
  if(value===null||value===undefined)return value;
  if(value instanceof Date)return value.toISOString();
  if(value instanceof Map)return Object.fromEntries([...value].map(([k,v])=>[k,plain(v,false)]));
  if(Array.isArray(value))return value.map(v=>plain(v,document));
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!document||!['_fence','__v'].includes(k)).map(([k,v])=>[document&&k==='_id'?'id':k,plain(v,false)]));
  return value;
}
/** One document per entity; no full-database read/modify/write operation. */
export class MongoRepository{
  constructor(session=null){this.session=session;}
  model(name){if(!models[name])throw new Error('Unknown collection '+name);return models[name];}
  opts(){return this.session?{session:this.session}:{};}
  async transaction(fn){
    if(this.session)return fn(this);
    return mongoose.connection.transaction(session=>fn(new MongoRepository(session)),{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary'});
  }
  async get(name,id){return this.findOne(name,{id});}
  async findOne(name,query){let q=this.model(name).findOne(encodeQuery(query));if(name==='users')q=q.select('+passwordHash');return plain(await q.session(this.session).lean());}
  async list(name,query={},options={}){
    const {limit=25,skip=0,sort={createdAt:-1,_id:-1}}=options;
    return plain(await this.model(name).find(encodeQuery(query)).sort(encodeQuery(sort)).skip(skip).limit(limit).session(this.session).lean());
  }
  count(name,q={}){return this.model(name).countDocuments(encodeQuery(q)).session(this.session);}
  async insert(name,value){
    const at=new Date().toISOString(),{id=randomUUID(),...fields}=value;
    const [doc]=await this.model(name).create([{...fields,_id:id,version:value.version??0,createdAt:value.createdAt||at,updatedAt:value.updatedAt||at}],this.opts());
    return plain(doc.toObject({flattenMaps:true}));
  }
  async save(name,value){
    const {id,version,createdAt,updatedAt,_fence,...fields}=value;
    const doc=await this.model(name).findOneAndUpdate({_id:id,version},{$set:{...fields,updatedAt:new Date()},$inc:{version:1}},{...this.opts(),new:true,runValidators:true}).lean();
    if(!doc)fail(409,'STALE_VERSION','This record changed. Refresh and review the latest version.');
    return plain(doc);
  }
  async updateMany(name,query,changes){return this.model(name).updateMany(encodeQuery(query),{$set:{...changes,updatedAt:new Date()},$inc:{version:1}},{...this.opts(),runValidators:true});}
  async removeWhere(name,query){if(!['sessions','receipts','otpChallenges','rateBuckets','otpCooldowns','identities','pushSubscriptions'].includes(name))throw new Error('Hard deletion of operational history is disabled.');return this.model(name).deleteMany(encodeQuery(query),this.opts());}
  async fence(name,id){const r=await this.model(name).updateOne({_id:id},{$inc:{_fence:1}},this.opts());if(!r.matchedCount)fail(409,'STALE_VERSION','The record is no longer available.');}
  async labourPage(query,options){
    const [result]=await models.labour.aggregate(labourPipeline(encodeQuery(query),options)).session(this.session);
    return {items:plain(result?.items||[]),total:result?.count?.[0]?.total||0};
  }
  async companySearchPage(name,query,{page=1,limit=25,companySearch=''}){
    const pipeline=[...companySearchStages(encodeQuery(query),companySearch),{$facet:{items:[{$sort:{createdAt:-1,_id:-1}},{$skip:(page-1)*limit},{$limit:limit}],count:[{$count:'total'}]}}];
    const [result]=await this.model(name).aggregate(pipeline).session(this.session);
    return {items:plain(result?.items||[]),total:result?.count?.[0]?.total||0};
  }
  async consumeRate(id,maximum,expiresAt){
    const doc=await models.rateBuckets.findOneAndUpdate({_id:id},{$inc:{count:1,version:1},$set:{updatedAt:new Date()},$setOnInsert:{createdAt:new Date(),expiresAt}},{upsert:true,new:true}).lean();
    return doc.count<=maximum;
  }
  async nextSequence(name){
    // Counters are initialized once by the explicit database index/bootstrap script.
    const counter=await this.model('counters').findOneAndUpdate({_id:name},{$inc:{value:1,version:1},$set:{updatedAt:new Date()}},{...this.opts(),new:true}).lean();
    if(!counter)fail(503,'DATABASE_NOT_INITIALIZED','Initialize database indexes and counters before accepting requests.');return counter.value;
  }
}
export async function initializeDatabase(){
  const {ensureIndexes}=await import('../models/index.js');await ensureIndexes();
  for(const id of ['labour','jobs'])await models.counters.updateOne({_id:id},{$setOnInsert:{value:1000,version:0,_fence:0,createdAt:new Date(),updatedAt:new Date()}},{upsert:true});
}
