import {randomInt,randomBytes,randomUUID,createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {fail,requireValue as check} from './errors.js';
import * as v from './validation.js';
import {userDTO} from './serializers.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export class AuthService{
  constructor(repo,domain,{secret,provider,clock=()=>new Date(),sessionHours=2160,staffSessionHours=2160}={}){this.repo=repo;this.domain=domain;this.secret=secret;this.provider=provider;this.clock=clock;this.sessionHours=sessionHours;this.staffSessionHours=staffSessionHours;}
  now(){return this.clock().toISOString();}
  hash(value){return createHmac('sha256',this.secret).update(value).digest('hex');}
  async limit(key,maximum,seconds){
    const window=Math.floor(this.clock().getTime()/(seconds*1000)),id=this.hash(key+':'+window);
    if(this.repo.consumeRate){if(!await this.repo.consumeRate(id,maximum,new Date((window+2)*seconds*1000).toISOString()))fail(429,'RATE_LIMIT','Too many attempts. Please try again later.');return;}
    return this.repo.transaction(async tx=>{let b=await tx.get('rateBuckets',id);if(!b)b=await tx.insert('rateBuckets',{id,count:0,expiresAt:new Date((window+2)*seconds*1000).toISOString()});if(b.count>=maximum)fail(429,'RATE_LIMIT','Too many attempts. Please try again later.');b.count++;await tx.save('rateBuckets',b);});
  }
  async requestOtp(b,ip,portal='client'){
    check(portal==='client'||portal==='staff','Invalid sign-in portal.');
    const channel=v.oneOf(b.channel,['email','sms'],'verification method');
    const destination=channel==='email'?v.email(b.contact,true):v.phone(b.contact,true),intent=v.oneOf(b.intent,['signin','signup'],'sign-in intent');
    if(portal==='staff'){
      check(intent==='signin','Staff accounts cannot be created from this sign-in page.');
      const identity=await this.repo.get('identities',channel+':'+destination),member=identity?await this.repo.get('users',identity.userId):null;
      const recruiter=await this.repo.findOne('recruiters',channel==='email'?{email:destination,active:true}:{phone:destination,active:true});
      check(member?.kind==='staff'&&member.status==='active'||recruiter,'This email or mobile number is not authorized for Marks HR staff access.');
    }
    const signup=intent==='signup'?{name:v.text(b.name,'Your name',100),companyName:v.optionalText(b.companyName,'Company name',120),secondary:channel==='email'?v.phone(b.secondary):v.email(b.secondary)}:{};
    await this.limit('otp-ip:'+ip,20,900);await this.limit('otp-destination:'+destination,6,900);
    if(portal==='client'&&intent==='signin'){
      const identity=await this.repo.get('identities',channel+':'+destination),account=identity?await this.repo.get('users',identity.userId):null;
      if(!account||account.kind!=='client')return {registrationRequired:true,message:'This email or phone is not connected to a client account. Please create an account first.'};
      if(account.status!=='active')fail(403,'ACCOUNT_UNAVAILABLE','This client account is unavailable. Contact staff.');
    }
    const id=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0'),at=this.clock().getTime(),cooldownId=this.hash('cooldown:'+destination);
    await this.repo.transaction(async tx=>{
      let c=await tx.get('otpCooldowns',cooldownId);if(c&&Date.parse(c.until)>at)fail(429,'RESEND_COOLDOWN','Wait before requesting another code.');
      const value={until:new Date(at+30000).toISOString(),expiresAt:new Date(at+900000).toISOString()};
      if(c){Object.assign(c,value);await tx.save('otpCooldowns',c);}else await tx.insert('otpCooldowns',{id:cooldownId,...value});
      // A resend supersedes prior challenges for this destination. Codes remain single-use.
      await tx.updateMany('otpChallenges',{destination,status:'pending'},{status:'locked'});
      await tx.insert('otpChallenges',{id,portal,channel,destination,codeHash:this.hash(id+':'+code),attempts:0,status:'pending',intent,signup,expiresAt:new Date(at+300000).toISOString()});
    });
    try{await this.provider.send({channel,to:destination,code});}
    catch(error){await this.repo.transaction(async tx=>{const c=await tx.get('otpChallenges',id);if(c&&c.status==='pending'){c.status='failed';await tx.save('otpChallenges',c);}});fail(503,'DELIVERY_UNAVAILABLE','The verification service is unavailable. Try again shortly.');}
    return {challengeId:id,expiresAt:new Date(at+300000).toISOString(),resendAt:new Date(at+30000).toISOString(),message:'A verification code was sent.'};
  }
  async requestStaffOtp({channel='email',contact,email},ip){return this.requestOtp({channel,contact:contact??email,intent:'signin'},ip,'staff');}
  async session(tx,u){
    const token=randomBytes(32).toString('base64url'),hours=u.kind==='staff'?this.staffSessionHours:this.sessionHours,expiresAt=new Date(this.clock().getTime()+hours*3600000).toISOString();
    await tx.insert('sessions',{tokenHash:sha(token),userId:u.id,portal:u.kind,authVersion:u.authVersion,expiresAt});
    return {token,expiresAt,user:userDTO(u,u.kind==='staff')};
  }
  async verifyOtp(b,ip,portal='client'){
    v.text(b.challengeId,'Challenge',80);check(typeof b.code==='string'&&/^\d{6}$/.test(b.code),'Enter the six-digit code.');await this.limit('verify-ip:'+ip,60,900);
    const result=await this.repo.transaction(async tx=>{
      const c=await tx.get('otpChallenges',b.challengeId);
      if(!c||(c.portal||'client')!==portal||c.status!=='pending'||Date.parse(c.expiresAt)<=this.clock().getTime())return {error:'The code expired or was already used. Request a new code.'};
      c.attempts++;
      if(!equal(c.codeHash,this.hash(c.id+':'+b.code))){if(c.attempts>=5)c.status='locked';await tx.save('otpChallenges',c);return {error:c.attempts>=5?'Too many attempts. Request a new code.':'The verification code is incorrect.'};}
      c.status='consumed';await tx.save('otpChallenges',c);
      let identity=await tx.get('identities',c.channel+':'+c.destination),u=identity?await tx.get('users',identity.userId):null;
      if(u&&(u.kind!==portal||u.status!=='active'))return {error:'This account is unavailable. Contact staff.'};
      if(portal==='staff'){
        if(!u){const recruiter=await tx.findOne('recruiters',c.channel==='email'?{email:c.destination,active:true}:{phone:c.destination,active:true});if(!recruiter)return {error:'Sign-in could not be completed. Contact an administrator.'};u=recruiter.userId?await tx.get('users',recruiter.userId):null;if(!u){const emailIdentity=await tx.get('identities','email:'+recruiter.email);u=emailIdentity?await tx.get('users',emailIdentity.userId):null;}if(!u)u=await tx.insert('users',{kind:'staff',name:recruiter.name,email:recruiter.email,normalizedEmail:recruiter.email,phone:recruiter.phone||'',normalizedPhone:recruiter.phone||'',emailAliases:[],phoneAliases:[],emailVerified:c.channel==='email',phoneVerified:c.channel==='sms',companyId:null,status:'active',authVersion:0});if(recruiter.userId!==u.id){recruiter.userId=u.id;await tx.save('recruiters',recruiter);}if(recruiter.phone&&!u.phone){u.phone=recruiter.phone;u.normalizedPhone=recruiter.phone;}await this.domain.claimIdentity(tx,c.channel,c.destination,u.id,true);}
        u.lastLoginAt=this.now();u=await tx.save('users',u);
        await this.domain.audit(tx,u,'staff.sso_signin','Marks HR staff signed in with a verification code.',null,u.id);
        return this.session(tx,u);
      }
      if(!u&&c.intent!=='signup')return {error:'Sign-in could not be completed. Create an account or contact staff.'};
      let createdCompany=null;
      if(!u){
        const known=c.signup.companyName?await tx.get('companyNames',v.nameKey(c.signup.companyName)):null;
        let companyId=null,requestedCompanyId=null;
        if(known)requestedCompanyId=known.companyId;
        else if(c.signup.companyName){createdCompany=await this.domain.createCompany(tx,{name:c.signup.companyName,contactName:c.signup.name},null);companyId=createdCompany.id;}
        u=await tx.insert('users',{kind:'client',name:c.signup.name,email:c.channel==='email'?c.destination:'',phone:c.channel==='sms'?c.destination:'',normalizedEmail:c.channel==='email'?c.destination:'',normalizedPhone:c.channel==='sms'?c.destination:'',emailAliases:[],phoneAliases:[],emailVerified:c.channel==='email',phoneVerified:c.channel==='sms',companyId,requestedCompanyId,requestedCompanyName:requestedCompanyId?c.signup.companyName:'',status:'active',authVersion:0,unverifiedEmail:c.channel==='sms'?c.signup.secondary:'',unverifiedPhone:c.channel==='email'?c.signup.secondary:''});
        // The optional secondary contact is never an authentication identity until independently verified.
        await this.domain.claimIdentity(tx,c.channel,c.destination,u.id,true);
        await this.domain.audit(tx,u,requestedCompanyId?'account.unassigned':'account.created',u.name+(requestedCompanyId?' requested a company link; staff approval is required.':' created an account.'),companyId,u.id,{requestedCompanyId});
      }else{
        identity.verified=true;await tx.save('identities',identity);
        if(c.channel==='email'&&u.email===c.destination)u.emailVerified=true;
        if(c.channel==='sms'&&u.phone===c.destination)u.phoneVerified=true;
      }
      u.lastLoginAt=this.now();u=await tx.save('users',u);
      await this.domain.audit(tx,u,'account.signin',u.name+' signed in.',u.companyId,u.id);
      const session=await this.session(tx,u);return createdCompany?{...session,createdCompany:{id:createdCompany.id,name:createdCompany.name,signupAt:createdCompany.signupAt}}:session;
    });
    // Throw outside the transaction: failed attempt counts and consumed codes must persist.
    if(result.error)fail(400,'OTP_INVALID',result.error);return result;
  }
  async verifyStaffOtp(b,ip){return this.verifyOtp(b,ip,'staff');}
  async authenticate(token,portal){
    if(!token||typeof token!=='string'||token.length>100)fail(401,'UNAUTHENTICATED','Please sign in.');
    const s=await this.repo.findOne('sessions',{tokenHash:sha(token),portal});
    if(!s||Date.parse(s.expiresAt)<=this.clock().getTime())fail(401,'SESSION_EXPIRED','Your session expired. Please sign in again.');
    const u=await this.repo.get('users',s.userId);
    if(!u||u.status!=='active'||u.kind!==portal||s.authVersion!==u.authVersion)fail(401,'SESSION_EXPIRED','Your access changed. Please sign in again.');
    return {user:u,session:s};
  }
  async logout(token,portal){if(token)await this.repo.removeWhere('sessions',{tokenHash:sha(token),portal});}
}
