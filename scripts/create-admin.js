import {connect} from './database.js';
import {CrewDeskService} from '../server/src/domain/service.js';
import {email as validateEmail,phone as validatePhone,text} from '../server/src/domain/validation.js';
const {repo,close}=await connect();
try{
  const email=validateEmail(process.env.ADMIN_EMAIL,true),phone=validatePhone(process.env.ADMIN_PHONE||''),name=text(process.env.ADMIN_NAME||'Marks HR administrator','Admin name',100),service=new CrewDeskService(repo);
  const user=await repo.transaction(async tx=>{
    if(await tx.get('identities','email:'+email))throw new Error('That contact already exists. This script will not overwrite an account.');
    const u=await tx.insert('users',{kind:'staff',name,email,normalizedEmail:email,phone,normalizedPhone:phone,emailAliases:[],phoneAliases:[],emailVerified:true,phoneVerified:!!phone,companyId:null,status:'active',authVersion:0});
    await service.claimIdentity(tx,'email',email,u.id,true);if(phone)await service.claimIdentity(tx,'sms',phone,u.id,true);await service.audit(tx,u,'staff.created','Marks HR administrator created by explicit administrative command.',null,u.id);return u;
  });
  console.log('Created Marks HR staff account:',user.email);
}finally{await close();}
