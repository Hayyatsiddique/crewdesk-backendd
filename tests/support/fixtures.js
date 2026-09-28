import {MemoryRepository} from './memory-repository.js';
import {CrewDeskService} from '../../server/src/domain/service.js';
import {AuthService} from '../../server/src/domain/auth.js';
export async function fixture(start='2026-09-22T15:00:00.000Z'){
  let instant=new Date(start);const clock=()=>instant,repo=new MemoryRepository({clock}),domain=new CrewDeskService(repo,{clock}),codes=new Map();
  const provider={send:async({to,code})=>codes.set(to,code)};
  const auth=new AuthService(repo,domain,{clock,secret:'x'.repeat(64),provider});
  const user=(id,kind,companyId)=>({id,kind,name:id,email:id+'@example.test',phone:'',normalizedEmail:id+'@example.test',normalizedPhone:'',emailAliases:[],phoneAliases:[],companyId,status:'active',authVersion:0});
  const staff=await repo.insert('users',user('staff','staff',null));await domain.claimIdentity(repo,'email',staff.email,staff.id,true);
  const ca=await domain.createCompany(repo,{name:'Company Alpha'}),cb=await domain.createCompany(repo,{name:'Company Beta'});ca.status=cb.status='active';await repo.save('companies',ca);await repo.save('companies',cb);
  const a=await repo.insert('users',user('alice','client',ca.id)),b=await repo.insert('users',user('bob','client',cb.id));
  for(const u of[a,b])await domain.claimIdentity(repo,'email',u.email,u.id,true);
  const site=await domain.execute(a,'site.create',{name:'Alpha Yard',address:'100 Example Street',zone:'America/Toronto',contactName:'Alice',contactPhone:'+14165550144',notes:'Gate 2',ppe:['Steel-toe boots']});
  const crew={role:'Warehouse associate',headcount:10,siteId:site.id,mode:'one',start:'2026-09-23',end:'',days:[],dates:[],startTime:'23:00',endTime:'07:00',equipment:'',tickets:['WHMIS'],licences:[],ppe:[],contactName:'Alice',contactPhone:'+14165550144',notes:'Load trailers'};
  const job={title:'Warehouse lead',description:'Lead a team safely.',start:'2026-09-23',end:'2026-12-23',location:'Toronto',workType:'Permanent',openings:2,licences:[]};
  return {repo,domain,auth,codes,staff,a,b,ca,cb,site,crew,job,clock,advance(ms){instant=new Date(instant.getTime()+ms);}};
}
