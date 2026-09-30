import {connect} from './database.js';
import {CrewDeskService} from '../server/src/domain/service.js';
import {plusDay,today} from '../server/src/domain/validation.js';
if(process.env.NODE_ENV==='production')throw new Error('Fictional demo seeding is disabled in production.');
const {repo,close}=await connect(),service=new CrewDeskService(repo);
try{
  const user=await repo.transaction(async tx=>{
    if(await tx.get('companyNames','northyardlogistics')||await tx.get('identities','email:client@northyard.example'))throw new Error('Northyard seed data already exists. Nothing was overwritten.');
    let c=await service.createCompany(tx,{name:'Northyard Logistics',email:'operations@northyard.example',phone:'+14165550144',contactName:'Alex Morgan'});
    c.status='active';c.industry='Warehousing & logistics';c.tickets=['WHMIS'];c.ppe=['Steel-toe boots','High-vis vest'];c=await tx.save('companies',c);
    const u=await tx.insert('users',{kind:'client',name:'Alex Morgan',email:'client@northyard.example',normalizedEmail:'client@northyard.example',phone:'+14165550144',normalizedPhone:'+14165550144',emailAliases:[],phoneAliases:[],emailVerified:true,phoneVerified:true,companyId:c.id,status:'active',authVersion:0});
    await service.claimIdentity(tx,'email',u.email,u.id,true);await service.claimIdentity(tx,'sms',u.phone,u.id,true);
    const site=await service.createSite(tx,u,{name:'Northyard Distribution Centre',address:'120 Example Industrial Road, Toronto, ON',zone:'America/Toronto',contactName:'Alex Morgan',contactPhone:u.phone,notes:'Fictional development record. Report to Gate 2.',ppe:c.ppe},null);
    await service.createLabour(tx,u,{role:'Warehouse associate',headcount:8,siteId:site.id,mode:'weekly',start:plusDay(today(),1),end:plusDay(today(),14),days:[1,2,3,4,5],dates:[],startTime:'07:00',endTime:'15:00',equipment:'',tickets:c.tickets,licences:[],ppe:c.ppe,contactName:u.name,contactPhone:u.phone,notes:'Fictional development request.'});
    await service.createJob(tx,u,{title:'Warehouse Team Lead',description:'Fictional role: coordinate safe day-to-day warehouse operations.',start:plusDay(today(),1),end:plusDay(today(),45),location:'Toronto, ON',workType:'Permanent',openings:1,licences:[]});
    return u;
  });console.log('Fictional development client:',user.email);console.log('Sign in using the development OTP printed by the server. Create staff separately with npm run admin:create.');
}finally{await close();}
