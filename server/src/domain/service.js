import {randomUUID, createHash} from 'node:crypto';
import {fail, requireValue as check, expectedVersion} from './errors.js';
import * as v from './validation.js';
import * as dto from './serializers.js';

const clone = x => structuredClone(x);
const referenceQuery = (value, prefix) => {
  v.text(value,'Record ID',80);
  return value.startsWith(prefix + '-') ? {referenceNumber:value} : {id:value};
};
const pageResult = (items, total, page, limit, extra = {}) => ({items,pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total / limit))},...extra});
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value;

/** Domain rules shared by the MongoDB runtime and dependency-free unit tests. */
export class CrewDeskService {
  constructor(repo, {clock = () => new Date()} = {}) { this.repo=repo; this.clock=clock; }
  now() { return this.clock().toISOString(); }
  staff(u) { if (u?.kind !== 'staff') fail(403,'STAFF_ONLY','This action is restricted to staff.'); }
  client(u) { if (u?.kind !== 'client') fail(403,'CLIENT_ONLY','Use a client account for this action.'); }
  async current(tx,u) {
    if (!u) fail(401,'UNAUTHENTICATED','Please sign in.');
    const current=await tx.get('users',u.id);
    if (!current || current.status !== 'active' || current.authVersion !== u.authVersion) fail(401,'SESSION_EXPIRED','Your access changed. Please sign in again.');
    return current;
  }
  async company(tx,u,id, {write=false,active=false,fence=false}={}) {
    const cid=u.kind==='client' ? u.companyId : id;
    if (!cid) fail(403,'COMPANY_LINK_REQUIRED','Staff must approve your company association before you can submit requests.');
    const c=await tx.get('companies',cid);
    if (!c || c.status==='merged') fail(404,'NOT_FOUND','Company not found.');
    if (u.kind==='client' && id && id!==cid) fail(404,'NOT_FOUND','Company not found.');
    if ((write && c.status==='suspended') || (active && c.status!=='active')) fail(422,'COMPANY_NOT_ACTIVE',active?'Activate the company before accepting or confirming work.':'Your company is on hold. New requests and roles are paused.');
    if (fence) await tx.fence('companies',c.id);
    return c;
  }
  async record(tx,u,collection,ref) {
    const q=referenceQuery(ref,collection==='labour'?'CR':'JR');
    if (u.kind==='client') q.companyId=u.companyId || '__unassigned__';
    const r=await tx.findOne(collection,q);
    if (!r) fail(404,'NOT_FOUND',collection==='labour'?'Request not found.':'Role not found.');
    return r;
  }
  async audit(tx,u,type,text,companyId=null,recordId=null,metadata={}) {
    return tx.insert('events',{type,text,companyId,actorId:u?.id||null,recordId,metadata,createdAt:this.now()});
  }
  async message(tx,u,r,text) {
    return tx.insert('messages',{requestId:r.id,companyId:r.companyId,senderType:u.kind,senderId:u.id,senderName:u.kind==='staff'?'Dispatch':u.name,text});
  }
  async companyView(tx,c,staff) {
    const sites=await tx.list('worksites',{companyId:c.id},{limit:100,sort:{createdAt:1}});
    return {...dto.companyDTO(c,sites,staff),worksitesTotal:await tx.count('worksites',{companyId:c.id}),peopleTotal:staff?await tx.count('users',{companyId:c.id,kind:'client',status:'active'}):undefined};
  }
  async labourView(tx,r,u,{messages=true}={}) {
    const rows=messages?await tx.list('messages',{requestId:r.id},{limit:100,sort:{createdAt:-1,id:-1}}):[];
    rows.reverse();
    return {...dto.labourDTO(r,rows,u.kind==='staff'),messagesTotal:messages?await tx.count('messages',{requestId:r.id}):0};
  }
  async jobView(tx,j,u) {
    const q={jobId:j.id}; if(u.kind!=='staff')q.published=true;
    const profiles=await tx.list('profiles',q,{limit:100,sort:{createdAt:1}});
    return {...dto.jobDTO(j,profiles,u.kind==='staff'),profilesTotal:await tx.count('profiles',q)};
  }
  async claimName(tx,key,companyId) {
    check(key.length>0,'Company name must contain letters or numbers.');
    const binding=await tx.get('companyNames',key);
    if(binding && binding.companyId!==companyId)fail(409,'DUPLICATE_COMPANY','That company name or alias exists. Use the merge workflow instead.');
    if(!binding)await tx.insert('companyNames',{id:key,companyId});
  }
  async claimIdentity(tx,channel,destination,userId,verified=false) {
    if(!destination)return;
    const id=channel+':'+destination, current=await tx.get('identities',id);
    if(current && current.userId!==userId)fail(409,'DUPLICATE_CONTACT','This email or phone already belongs to a contact. Link that contact instead.');
    if(!current)await tx.insert('identities',{id,channel,destination,userId,verified});
  }
  async savePushSubscription(u,subscription) {
    this.client(u);
    const endpointHash=createHash('sha256').update(subscription.endpoint).digest('hex');
    return this.repo.transaction(async tx=>{
      await this.current(tx,u);
      const current=await tx.get('pushSubscriptions',endpointHash),value={id:endpointHash,userId:u.id,endpoint:subscription.endpoint,expirationTime:subscription.expirationTime??null,keys:subscription.keys};
      if(current)return tx.save('pushSubscriptions',{...current,...value});
      return tx.insert('pushSubscriptions',value);
    });
  }
  async createCompany(tx,{name,email='',phone='',contactName=''},u=null) {
    const c=await tx.insert('companies',{name,normalizedName:v.nameKey(name),aliases:[],status:'pending',industry:'',email,phone,
      billingContact:{name:contactName,email,phone},defaultShifts:clone(v.DEFAULT_SHIFTS),tickets:[],licences:[],ppe:[],notes:'',signupAt:this.now()});
    await this.claimName(tx,c.normalizedName,c.id);
    await this.audit(tx,u,'company.signup',c.name+' signed up and is awaiting approval.',c.id);
    return c;
  }
  /** All writes use a transaction. A receipt and business change commit together. */
  async execute(actor,command,body={},resourceId='',{key,route=command}={}) {
    if(key)check(typeof key==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(key),'Invalid idempotency key.');
    const fingerprint=createHash('sha256').update(JSON.stringify(stable({command,resourceId,body,route}))).digest('hex');
    const receiptId=key?`${actor.id}:${actor.authVersion}:${key}`:null;
    const replay=async tx=>{
      const cached=receiptId?await tx.get('receipts',receiptId):null;
      if(cached){if(cached.fingerprint!==fingerprint)fail(409,'IDEMPOTENCY_CONFLICT','This retry key was already used for a different request.');return clone(cached.result);}
    };
    try {
      return await this.repo.transaction(async tx=>{
        const u=await this.current(tx,actor); const cached=await replay(tx); if(cached!==undefined)return cached;
        await tx.fence('users',u.id);
        const method=this.commands[command]; if(!method)fail(404,'UNKNOWN_ACTION','Unknown action.');
        const result=await method.call(this,tx,u,body,resourceId);
        if(receiptId)await tx.insert('receipts',{id:receiptId,userId:u.id,fingerprint,result,expiresAt:new Date(this.clock().getTime()+86400000).toISOString()});
        return result;
      });
    } catch(error) {
      // Concurrent identical retries may meet a unique-key conflict. Replay only after commit.
      if(receiptId && error.code===11000){await this.current(this.repo,actor);const cached=await replay(this.repo);if(cached!==undefined)return cached;}
      throw error;
    }
  }
  get commands() {
    return {
      'company.update':this.updateCompany,'company.status':this.companyStatus,'company.merge':this.mergeCompanies,
      'recruiter.create':this.createRecruiter,'recruiter.contact':this.updateRecruiterContact,'recruiter.signup-notifications':this.updateRecruiterSignupNotifications,'recruiter.remove':this.removeRecruiter,'company.recruiter':this.assignCompanyRecruiter,'labour.recruiter':this.assignLabourRecruiter,
      'site.create':this.createSite,'site.update':this.updateSite,
      'account.create':this.createContact,'account.link':this.linkContact,'account.remove':this.removeContact,'account.merge':this.mergeContacts,
      'labour.create':this.createLabour,'labour.accept':this.acceptLabour,'labour.confirm':this.confirmLabour,
      'labour.message':this.sendMessage,'labour.note':this.labourNote,'labour.change':this.requestChange,
      'labour.cancel':this.requestCancel,'labour.resolve':this.resolveChange,
      'job.create':this.createJob,'job.status':this.jobStatus,'job.note':this.jobNote,'job.profile':this.addProfile,
      'events.read':this.markRead
    };
  }
  async updateCompany(tx,u,b,id) {
    this.staff(u); const c=await this.company(tx,u,id); expectedVersion(c,b.version); const values=v.companyInput(b);
    await this.claimName(tx,v.nameKey(values.name),c.id);
    if(c.name!==values.name)c.aliases=v.unique([...c.aliases,c.name]);
    Object.assign(c,values,{normalizedName:v.nameKey(values.name)}); const saved=await tx.save('companies',c);
    await this.audit(tx,u,'company.updated',c.name+' profile, shifts and requirements updated.',c.id);
    return this.companyView(tx,saved,true);
  }
  async companyStatus(tx,u,b,id) {
    this.staff(u);const c=await this.company(tx,u,id);expectedVersion(c,b.version);
    c.status=v.oneOf(b.status,['active','suspended'],'company status');const saved=await tx.save('companies',c);
    await this.audit(tx,u,c.status==='active'?'company.approved':'company.held',c.name+(c.status==='active'?' activated.':' placed on hold.'),c.id);
    return this.companyView(tx,saved,true);
  }
  async createRecruiter(tx,u,b) {
    this.staff(u);const name=v.text(b.name,'Recruiter name',100),email=v.email(b.email,true),phone=v.phone(b.phone),whatsappPhone=v.phone(b.whatsappPhone);
    const existing=await tx.findOne('recruiters',{email});
    if(existing){
      if(existing.active)fail(409,'DUPLICATE','A recruiter with this email already exists.');
      existing.name=name;existing.phone=phone;existing.whatsappPhone=whatsappPhone;existing.active=true;
      if(existing.userId){const member=await tx.get('users',existing.userId);if(member){member.status='active';member.authVersion++;await tx.save('users',member);}}
      const restored=await tx.save('recruiters',existing);
      await this.audit(tx,u,'recruiter.reactivated',name+' restored to the active recruiter team.',null,restored.id);
      return {id:restored.id,version:restored.version,name:restored.name,email:restored.email,phone:restored.phone,whatsappPhone:restored.whatsappPhone||'',active:restored.active,userId:restored.userId,createdAt:restored.createdAt,updatedAt:restored.updatedAt};
    }
    const recruiter=await tx.insert('recruiters',{name,email,phone,whatsappPhone,signupNotificationChannels:['email'],active:true,userId:null});
    await this.audit(tx,u,'recruiter.created',name+' added to the recruiter team.',null,recruiter.id);
    return {id:recruiter.id,version:recruiter.version,name:recruiter.name,email:recruiter.email,phone:recruiter.phone,whatsappPhone:recruiter.whatsappPhone||'',signupNotificationChannels:recruiter.signupNotificationChannels,active:recruiter.active,userId:recruiter.userId,createdAt:recruiter.createdAt,updatedAt:recruiter.updatedAt};
  }
  async updateRecruiterContact(tx,u,b,id) {
    this.staff(u);const recruiter=await tx.get('recruiters',id);if(!recruiter||!recruiter.active)fail(404,'NOT_FOUND','Team member not found.');expectedVersion(recruiter,b.version);
    const email=v.email(b.email,true),phone=v.phone(b.phone),whatsappPhone=v.phone(b.whatsappPhone),duplicate=await tx.findOne('recruiters',{email});
    if(duplicate&&duplicate.id!==recruiter.id)fail(409,'DUPLICATE','A recruiter with this email already exists.');
    const oldEmail=recruiter.email,oldPhone=recruiter.phone;
    if(recruiter.userId){
      const member=await tx.get('users',recruiter.userId);
      if(!member||member.kind!=='staff'||member.status!=='active')fail(409,'ACCOUNT_UNAVAILABLE','This recruiter sign-in account is unavailable. Reactivate the team member first.');
      const moveIdentity=async(channel,from,to)=>{
        if(from===to)return;
        const next=to?await tx.get('identities',channel+':'+to):null;
        if(next&&next.userId!==member.id)fail(409,'DUPLICATE_CONTACT','This email or phone already belongs to a contact. Link that contact instead.');
        if(to)await this.claimIdentity(tx,channel,to,member.id,true);
        const previous=from?await tx.get('identities',channel+':'+from):null;
        if(previous&&previous.userId===member.id)await tx.removeWhere('identities',{id:previous.id});
      };
      await moveIdentity('email',oldEmail,email);await moveIdentity('sms',oldPhone,phone);
      member.email=email;member.normalizedEmail=email;member.phone=phone;member.normalizedPhone=phone;await tx.save('users',member);
    }else{
      for(const [channel,destination] of [['email',email],['sms',phone]]){const identity=destination?await tx.get('identities',channel+':'+destination):null;if(identity)fail(409,'DUPLICATE_CONTACT','This email or phone already belongs to a contact. Link that contact instead.');}
    }
    recruiter.email=email;recruiter.phone=phone;recruiter.whatsappPhone=whatsappPhone;const saved=await tx.save('recruiters',recruiter);
    await this.audit(tx,u,'recruiter.contact_updated',saved.name+' work email and contact numbers updated.',null,saved.id);return {id:saved.id,version:saved.version,name:saved.name,email:saved.email,phone:saved.phone,whatsappPhone:saved.whatsappPhone||'',signupNotificationChannels:saved.signupNotificationChannels??['email'],active:saved.active,userId:saved.userId,createdAt:saved.createdAt,updatedAt:saved.updatedAt};
  }
  async updateRecruiterSignupNotifications(tx,u,b,id) {
    this.staff(u);const recruiter=await this.recruiter(tx,id);expectedVersion(recruiter,b.version);
    recruiter.signupNotificationChannels=[...new Set((b.notificationChannels||[]).map(channel=>v.oneOf(channel,['email','sms'],'new-company notification channel')))];
    const saved=await tx.save('recruiters',recruiter);
    await this.audit(tx,u,'recruiter.signup_notifications_updated',saved.name+' new-company notification settings updated.',null,saved.id,{channels:saved.signupNotificationChannels});
    return {id:saved.id,version:saved.version,signupNotificationChannels:saved.signupNotificationChannels};
  }
  async removeRecruiter(tx,u,b,id) {
    this.staff(u);const recruiter=await tx.get('recruiters',id);if(!recruiter||!recruiter.active)fail(404,'NOT_FOUND','Team member not found.');expectedVersion(recruiter,b.version);
    recruiter.active=false;await tx.save('recruiters',recruiter);
    if(recruiter.userId){const member=await tx.get('users',recruiter.userId);if(member){member.status='disabled';member.authVersion++;await tx.save('users',member);await tx.removeWhere('sessions',{userId:member.id});}}
    for(const collection of ['companies','labour']){const rows=await tx.list(collection,{},{limit:0});for(const row of rows.filter(value=>(value.recruiterIds||[]).includes(id)||value.recruiterId===id)){row.recruiterIds=(row.recruiterIds||[]).filter(value=>value!==id);row.recruiterId=row.recruiterIds[0]||null;delete (row.recruiterNotifications||{})[id];await tx.save(collection,row);}}
    await this.audit(tx,u,'recruiter.removed',recruiter.name+' removed from the active team and signed out.',null,recruiter.id);return {id:recruiter.id,active:false};
  }
  async recruiter(tx,id) {
    const recruiter=await tx.get('recruiters',id);if(!recruiter||!recruiter.active)fail(404,'NOT_FOUND','Recruiter not found.');return recruiter;
  }
  async recruiterNotificationChannels(recruiterIds,settings) {
    const allowed=['sms','whatsapp','email','voice'],result={};
    for(const recruiterId of recruiterIds){
      const channels=settings?.[recruiterId]===undefined?['email']:settings[recruiterId];
      check(Array.isArray(channels),'Choose valid notification channels.');
      result[recruiterId]=[...new Set(channels.map(channel=>v.oneOf(channel,allowed,'notification channel')))];
    }
    for(const recruiterId of Object.keys(settings||{}))check(recruiterIds.includes(recruiterId),'Notification settings require an assigned recruiter.');
    return result;
  }
  async assignCompanyRecruiter(tx,u,b,id) {
    this.staff(u);const c=await this.company(tx,u,id,{fence:true});expectedVersion(c,b.version);const recruiterIds=[...new Set(b.recruiterIds||[])];for(const recruiterId of recruiterIds)await this.recruiter(tx,recruiterId);c.recruiterIds=recruiterIds;c.recruiterId=recruiterIds[0]||null;c.recruiterNotifications=await this.recruiterNotificationChannels(recruiterIds,b.notificationChannels);const saved=await tx.save('companies',c);
    await this.audit(tx,u,'company.recruiter_assigned',c.name+(recruiterIds.length?' recruiters assigned.':' recruiter assignment cleared.'),c.id,c.id,{recruiterIds});
    return this.companyView(tx,saved,true);
  }
  async assignLabourRecruiter(tx,u,b,ref) {
    this.staff(u);const r=await this.record(tx,u,'labour',ref);expectedVersion(r,b.version);const recruiterIds=[...new Set(b.recruiterIds||[])];for(const recruiterId of recruiterIds)await this.recruiter(tx,recruiterId);r.recruiterIds=recruiterIds;r.recruiterId=recruiterIds[0]||null;r.recruiterNotifications=await this.recruiterNotificationChannels(recruiterIds,b.notificationChannels);const saved=await tx.save('labour',r);
    await this.audit(tx,u,'labour.recruiter_assigned',r.referenceNumber+(recruiterIds.length?' recruiters assigned.':' now uses the company recruiters.'),r.companyId,r.referenceNumber,{recruiterIds});
    return this.labourView(tx,saved,u);
  }
  async createSite(tx,u,b,id) {
    const c=await this.company(tx,u,id,{fence:true}); const site=await tx.insert('worksites',{...v.siteInput(b),companyId:c.id});
    await this.audit(tx,u,'site.added',site.name+' added.',c.id,site.id);return dto.siteDTO(site);
  }
  async updateSite(tx,u,b,id) {
    const site=await tx.get('worksites',id);if(!site)fail(404,'NOT_FOUND','Worksite not found.');
    await this.company(tx,u,site.companyId,{fence:true});expectedVersion(site,b.version);
    Object.assign(site,v.siteInput(b));const saved=await tx.save('worksites',site);
    await this.audit(tx,u,'site.updated',site.name+' updated. Existing request snapshots were retained.',site.companyId,site.id);
    return dto.siteDTO(saved);
  }
  async createContact(tx,u,b) {
    this.staff(u); const name=v.text(b.name,'Contact name',100), email=v.email(b.email),phone=v.phone(b.phone);
    check(email||phone,'Provide at least one email or phone number.');
    if(b.companyId)await this.company(tx,u,b.companyId,{fence:true});
    const a=await tx.insert('users',{kind:'client',name,email,phone,normalizedEmail:email,normalizedPhone:phone,
      emailAliases:[],phoneAliases:[],emailVerified:false,phoneVerified:false,companyId:b.companyId||null,status:'active',notificationStatus:'pending_login',notificationsActivatedAt:null,authVersion:0});
    await this.claimIdentity(tx,'email',email,a.id);await this.claimIdentity(tx,'sms',phone,a.id);
    await this.audit(tx,u,'account.pre_registered',name+(b.companyId?' pre-registered for '+(await tx.get('companies',b.companyId)).name+'.':' pre-registered as an unassigned contact.')+' Notifications stay off until their first verified sign-in.',a.companyId,a.id);
    return dto.userDTO(a,true);
  }
  async linkContact(tx,u,b,id) {
    this.staff(u);check(b.confirm===true,'Confirm this company association.');
    const a=await tx.get('users',id);if(!a||a.kind!=='client'||a.status!=='active')fail(404,'NOT_FOUND','Contact not found.');
    expectedVersion(a,b.version);const c=await this.company(tx,u,b.companyId,{fence:true});const old=a.companyId;
    // This is an explicit approval of the account's requested company. Keep its
    // authenticated devices signed in: every request reads the current user, so
    // the newly approved company scope takes effect immediately. Identity,
    // account-merge, removal, and disable actions still revoke sessions.
    a.companyId=c.id;a.requestedCompanyId=null;a.requestedCompanyName='';
    const result=await tx.save('users',a);
    await this.audit(tx,u,'account.linked',a.name+' linked to '+c.name+'. Existing requests remain with their original companies.',c.id,a.id,{previousCompanyId:old,refreshUserIds:[a.id]});
    return dto.userDTO(result,true);
  }
  async removeContact(tx,u,b,id) {
    this.staff(u);const a=await tx.get('users',id);
    if(!a||a.kind!=='client'||a.status!=='active')fail(404,'NOT_FOUND','Active client contact not found.');
    expectedVersion(a,b.version);a.status='disabled';a.authVersion++;
    const saved=await tx.save('users',a);await tx.removeWhere('sessions',{userId:a.id});
    await this.audit(tx,u,'account.disabled',a.name+' client access disabled. Historical requests and audit records were retained.',a.companyId,a.id,{affectedUserIds:[a.id]});
    return dto.userDTO(saved,true);
  }
  async mergeCompanies(tx,u,b) {
    this.staff(u);check(b.confirm===true,'Confirm the company merge.');check(b.sourceId!==b.targetId,'Choose two different companies.');
    const s=await this.company(tx,u,b.sourceId),t=await this.company(tx,u,b.targetId);
    expectedVersion(s,b.sourceVersion);expectedVersion(t,b.targetVersion);
    // Referenced site IDs are globally unique; historical snapshots are never rewritten.
    await tx.updateMany('worksites',{companyId:s.id},{companyId:t.id});
    await tx.updateMany('labour',{companyId:s.id},{companyId:t.id});
    await tx.updateMany('jobs',{companyId:s.id},{companyId:t.id});
    await tx.updateMany('profiles',{companyId:s.id},{companyId:t.id});
    await tx.updateMany('messages',{companyId:s.id},{companyId:t.id});
    const moved=await tx.list('users',{kind:'client',$or:[{companyId:s.id},{requestedCompanyId:s.id}]},{limit:0});
    for(const a of moved){if(a.companyId===s.id)a.companyId=t.id;if(a.requestedCompanyId===s.id)a.requestedCompanyId=t.id;a.authVersion++;await tx.save('users',a);await tx.removeWhere('sessions',{userId:a.id});}
    // Retain immutable original scope for audit attribution while making history discoverable in the survivor.
    await tx.updateMany('events',{companyId:s.id},{companyId:t.id,'metadata.mergedFromCompanyId':s.id,'metadata.mergedFromCompanyName':s.name});
    await tx.updateMany('companyNames',{companyId:s.id},{companyId:t.id});
    t.aliases=v.unique([...t.aliases,s.name,...s.aliases]);
    const assigned=[...new Set([...(t.recruiterIds?.length?t.recruiterIds:(t.recruiterId?[t.recruiterId]:[])),...(s.recruiterIds?.length?s.recruiterIds:(s.recruiterId?[s.recruiterId]:[]))])];
    t.recruiterIds=[];for(const recruiterId of assigned){const recruiter=await tx.get('recruiters',recruiterId);if(recruiter?.active)t.recruiterIds.push(recruiterId);}t.recruiterId=t.recruiterIds[0]||null;t.recruiterNotifications=Object.fromEntries(t.recruiterIds.map(recruiterId=>[recruiterId,t.recruiterNotifications?.[recruiterId]??s.recruiterNotifications?.[recruiterId]??['email']]));
    for(const k of ['tickets','licences','ppe']){t[k]=v.unique([...t[k],...s[k]]);check(t[k].length<=100,'Combine duplicate requirements before merging; at most 100 values are supported in each category.');}
    for(const shift of s.defaultShifts){
      if(t.defaultShifts.some(x=>x.name.toLowerCase()===shift.name.toLowerCase()&&x.startTime===shift.startTime&&x.endTime===shift.endTime))continue;
      let name=shift.name;
      if(t.defaultShifts.some(x=>x.name.toLowerCase()===name.toLowerCase()))name=(s.name+' / '+name).slice(0,90);
      let suffix=2,base=name;while(t.defaultShifts.some(x=>x.name.toLowerCase()===name.toLowerCase()))name=base+' '+suffix++;
      t.defaultShifts.push({...shift,id:randomUUID(),name});
    }
    check(t.defaultShifts.length<=30,'The combined company has over 30 shift templates. Remove redundant templates before merging.');
    if(s.notes)t.notes=(t.notes?'\n'+t.notes+'\n':'')+'Merged from '+s.name+':\n'+s.notes;
    check(t.notes.length<=5000,'Combine the company notes before merging; the merged notes are too long.');
    const saved=await tx.save('companies',t);s.status='merged';s.mergedInto=t.id;await tx.save('companies',s);
    await this.audit(tx,u,'company.merged',s.name+' merged into '+t.name+'; history and original site snapshots retained.',t.id,t.id,{sourceCompanyId:s.id,affectedUserIds:moved.map(a=>a.id)});
    return this.companyView(tx,saved,true);
  }
  async mergeContacts(tx,u,b) {
    this.staff(u);check(b.confirm===true,'Confirm the contact merge.');check(b.sourceId!==b.targetId,'Choose different contacts.');
    const s=await tx.get('users',b.sourceId),t=await tx.get('users',b.targetId);
    if(!s||!t||s.kind!=='client'||t.kind!=='client'||s.status!=='active'||t.status!=='active')fail(404,'NOT_FOUND','Choose two active client contacts.');
    expectedVersion(s,b.sourceVersion);expectedVersion(t,b.targetVersion);
    // New duplicates are prevented. This supports a deliberate, confirmed merge of legacy/imported contacts.
    if(b.companyId)await this.company(tx,u,b.companyId,{fence:true});
    const identityRows=await tx.list('identities',{userId:s.id},{limit:0});
    for(const row of identityRows){row.userId=t.id;await tx.save('identities',row);}
    t.emailAliases=v.unique([...t.emailAliases,...s.emailAliases,s.email].filter(x=>x&&x!==t.email));
    t.phoneAliases=v.unique([...t.phoneAliases,...s.phoneAliases,s.phone].filter(x=>x&&x!==t.phone));
    if(!t.email){t.email=s.email;t.normalizedEmail=s.normalizedEmail;t.emailVerified=s.emailVerified;}
    if(!t.phone){t.phone=s.phone;t.normalizedPhone=s.normalizedPhone;t.phoneVerified=s.phoneVerified;}
    t.companyId=b.companyId||null;t.authVersion++;s.status='merged';s.mergedInto=t.id;s.authVersion++;
    const saved=await tx.save('users',t);await tx.save('users',s);
    await tx.updateMany('labour',{accountId:s.id},{accountId:t.id});await tx.updateMany('jobs',{accountId:s.id},{accountId:t.id});
    await tx.updateMany('events',{actorId:s.id},{actorId:t.id,'metadata.originalActorId':s.id,'metadata.originalActorName':s.name});
    await tx.removeWhere('sessions',{userId:{$in:[s.id,t.id]}});
    await this.audit(tx,u,'account.merged',s.name+' merged into '+t.name+'. Both accounts were signed out.',t.companyId,t.id,{sourceAccountId:s.id,affectedUserIds:[s.id,t.id]});
    return dto.userDTO(saved,true);
  }
  async createLabour(tx,u,b) {
    this.client(u);const c=await this.company(tx,u,null,{write:true,fence:true});const site=await tx.get('worksites',b.siteId);
    if(!site||site.companyId!==c.id)fail(404,'NOT_FOUND','Choose a worksite from your company.');
    const values=v.crewInput(b,site,this.clock());
    const referenceNumber='CR-'+await tx.nextSequence('labour');
    const r=await tx.insert('labour',{...values,referenceNumber,companyId:c.id,accountId:u.id,siteId:site.id,
      site:{...dto.siteDTO(site),contactName:values.contactName,contactPhone:values.contactPhone},phase:'new',fills:{},pendingChange:null,pendingCancel:null,internalNotes:''});
    await this.audit(tx,u,'labour.submitted',u.name+' requested '+r.headcount+' '+r.role+' at '+site.name+'.',c.id,referenceNumber);
    return this.labourView(tx,r,u);
  }
  async activeLabour(tx,u,ref,version) {
    this.staff(u);const r=await this.record(tx,u,'labour',ref);expectedVersion(r,version);
    if(r.phase==='cancelled')fail(422,'CANCELLED','This request is cancelled.');
    await this.company(tx,u,r.companyId,{active:true,fence:true});return r;
  }
  async acceptLabour(tx,u,b,ref) {
    const r=await this.activeLabour(tx,u,ref,b.version);
    if(r.pendingChange||r.pendingCancel)fail(422,'PENDING_REVIEW','Resolve the pending change or cancellation first.');
    if(!['new','info'].includes(r.phase))fail(422,'ALREADY_ACCEPTED','This request is already in staffing.');
    r.phase='staffing';const saved=await tx.save('labour',r);
    await this.message(tx,u,r,'Request accepted. We are staffing your shifts; worker counts will be confirmed for each date.');
    await this.audit(tx,u,'labour.accepted',r.referenceNumber+' accepted for staffing.',r.companyId,r.referenceNumber);
    return this.labourView(tx,saved,u);
  }
  async confirmLabour(tx,u,b,ref) {
    const r=await this.activeLabour(tx,u,ref,b.version);
    if(r.pendingChange||r.pendingCancel)fail(422,'PENDING_REVIEW','Resolve the pending change or cancellation first.');
    check(v.scheduleHas(r,b.date),'Choose a date included in this request.');
    const requested=v.headcountFor(r,b.date),count=v.integer(b.count,'Confirmed headcount',0,requested),workers=(b.workers||[]).map(x=>({name:v.text(x.name,'Worker name',100),phone:v.phone(x.phone)}));check(!workers.length||workers.length===count,'Add a name and contact number for every confirmed worker.');r.fills={...r.fills,[b.date]:count};r.workers={...r.workers,[b.date]:workers};
    r.phase=r.mode==='one'&&count===requested?'filled':'staffing';const saved=await tx.save('labour',r);
    await this.message(tx,u,r,`${count} of ${requested} people confirmed for ${b.date}.`);
    await this.audit(tx,u,'labour.confirmed',`${r.referenceNumber}: ${count} of ${requested} confirmed for ${b.date}.`,r.companyId,r.referenceNumber,{date:b.date,count,requested});
    return this.labourView(tx,saved,u);
  }
  async sendMessage(tx,u,b,ref) {
    const r=await this.record(tx,u,'labour',ref);if(r.phase==='cancelled')fail(422,'CANCELLED','This request is cancelled.');
    const text=v.text(b.text,'Message',2000);const needInfo=b.needInfo===true;
    if(needInfo)this.staff(u);
    await this.message(tx,u,r,text);if(needInfo)r.phase='info';const saved=await tx.save('labour',r);
    await this.audit(tx,u,needInfo?'labour.need_info':'labour.message',r.referenceNumber+': '+(needInfo?'client information requested.':u.kind==='client'?'client message received.':'dispatch reply saved.'),r.companyId,r.referenceNumber);
    return this.labourView(tx,saved,u);
  }
  async setNote(tx,u,b,ref,collection) {
    this.staff(u);const r=await this.record(tx,u,collection,ref);expectedVersion(r,b.version);
    r.internalNotes=v.optionalText(b.text,'Internal notes',5000);const saved=await tx.save(collection,r);
    await this.audit(tx,u,collection==='labour'?'labour.note':'job.note',r.referenceNumber+': internal notes updated.',r.companyId,r.referenceNumber);
    return collection==='labour'?this.labourView(tx,saved,u):this.jobView(tx,saved,u);
  }
  async labourNote(tx,u,b,ref){return this.setNote(tx,u,b,ref,'labour');}
  async jobNote(tx,u,b,ref){return this.setNote(tx,u,b,ref,'jobs');}
  async pendingRequest(tx,u,b,ref,cancel) {
    this.client(u);const r=await this.record(tx,u,'labour',ref);expectedVersion(r,b.version);
    if(r.phase==='cancelled')fail(422,'CANCELLED','This request is cancelled.');
    if(r.pendingChange||r.pendingCancel)fail(409,'PENDING_REVIEW','A change or cancellation is already waiting for review.');
    const pending={id:randomUUID(),reason:v.text(b.reason,'Reason',1000),requestedAt:this.now(),requestedBy:u.id};
    if(cancel)r.pendingCancel=pending;
    else r.pendingChange={...pending,headcount:v.integer(b.headcount,'Headcount',1,500),...v.times(b.startTime,b.endTime)};
    const saved=await tx.save('labour',r);
    await this.audit(tx,u,cancel?'labour.cancellation_requested':'labour.change_requested',r.referenceNumber+': '+(cancel?'cancellation':'change')+' requested; original request remains operational.',r.companyId,r.referenceNumber);
    return this.labourView(tx,saved,u);
  }
  async requestChange(tx,u,b,ref){return this.pendingRequest(tx,u,b,ref,false);}
  async requestCancel(tx,u,b,ref){return this.pendingRequest(tx,u,b,ref,true);}
  async resolveChange(tx,u,b,ref) {
    this.staff(u);const r=await this.record(tx,u,'labour',ref);expectedVersion(r,b.version);
    check(typeof b.approve==='boolean','Choose approve or decline.');
    if(!r.pendingCancel&&!r.pendingChange)fail(409,'ALREADY_RESOLVED','This request was already resolved.');
    const cancel=!!r.pendingCancel,pending=r.pendingCancel||r.pendingChange;
    if(b.pendingId && pending.id!==b.pendingId)fail(409,'STALE_REVIEW','A different change is now awaiting review.');
    if(r.phase==='cancelled')fail(422,'CANCELLED','The operational request is already cancelled.');
    if(b.approve&&!cancel){await this.company(tx,u,r.companyId,{active:true,fence:true});Object.assign(r,{headcount:pending.headcount,startTime:pending.startTime,endTime:pending.endTime,fills:{},phase:'staffing'});}
    if(b.approve&&cancel)r.phase='cancelled';r.pendingChange=null;r.pendingCancel=null;
    const saved=await tx.save('labour',r);
    await this.message(tx,u,r,(cancel?'Cancellation':'Change')+' '+(b.approve?'approved.':'declined.')+(b.approve&&!cancel?' All dates need new worker confirmations.':''));
    await this.audit(tx,u,'labour.change_resolved',r.referenceNumber+' '+(cancel?'cancellation':'change')+' '+(b.approve?'approved.':'declined.'),r.companyId,r.referenceNumber,{pending,approve:b.approve});
    return this.labourView(tx,saved,u);
  }
  async createJob(tx,u,b) {
    this.client(u);const c=await this.company(tx,u,null,{write:true,fence:true}),values=v.jobInput(b,this.clock());
    const j=await tx.insert('jobs',{...values,referenceNumber:'JR-'+await tx.nextSequence('jobs'),companyId:c.id,accountId:u.id,status:'new',internalNotes:''});
    await this.audit(tx,u,'job.posted',u.name+' opened '+j.title+' ('+j.openings+' openings).',c.id,j.referenceNumber);
    return this.jobView(tx,j,u);
  }
  async jobStatus(tx,u,b,ref) {
    this.staff(u);const j=await this.record(tx,u,'jobs',ref);expectedVersion(j,b.version);
    const status=v.oneOf(b.status,['new','sourcing','shortlist','closed'],'role status');
    // The approved select deliberately permits reopening/reverting a role. Published profiles stay shared.
    if(['sourcing','shortlist'].includes(status))await this.company(tx,u,j.companyId,{active:true,fence:true});
    if(status==='shortlist'){
      if(!await tx.count('profiles',{jobId:j.id}))fail(422,'EMPTY_SHORTLIST','Add at least one screened profile before sharing a shortlist.');
      await tx.updateMany('profiles',{jobId:j.id,published:false},{published:true,publishedAt:this.now()});
    }
    j.status=status;const saved=await tx.save('jobs',j);
    await this.audit(tx,u,'job.status',j.referenceNumber+' moved to '+status+'.',j.companyId,j.referenceNumber);
    return this.jobView(tx,saved,u);
  }
  async addProfile(tx,u,b,ref) {
    this.staff(u);const j=await this.record(tx,u,'jobs',ref);expectedVersion(j,b.version);
    if(j.status==='closed')fail(422,'ROLE_CLOSED','Reopen the role before adding a new profile.');
    await tx.insert('profiles',{jobId:j.id,companyId:j.companyId,name:v.text(b.name,'Candidate name',100),summary:v.text(b.summary,'Screening note',3000),resumeText:v.text(b.resumeText,'Resume summary',10000),published:false,publishedAt:null});
    const saved=await tx.save('jobs',j);
    await this.audit(tx,u,'job.profile_added',j.referenceNumber+': an internal draft profile was added.',j.companyId,j.referenceNumber);
    return this.jobView(tx,saved,u);
  }
  async markRead(tx,u,b) {
    this.staff(u);v.text(b.through,'Notification cutoff',40);
    check(!Number.isNaN(Date.parse(b.through)) && Date.parse(b.through)<=this.clock().getTime()+5000,'Invalid notification cutoff.');
    const id=u.id+':company.signup',existing=await tx.get('readCursors',id);
    if(!existing)await tx.insert('readCursors',{id,userId:u.id,type:'company.signup',through:b.through});
    else if(b.through>existing.through){existing.through=b.through;await tx.save('readCursors',existing);}
    await this.audit(tx,u,'notification.read','Signup alerts marked read.',null,u.id,{affectedUserIds:[],notificationUserId:u.id});
    return {read:true,through:b.through};
  }

  async relatedCompanies(tx,items) {
    const ids=[...new Set(items.map(r=>r.companyId).filter(Boolean))];if(!ids.length)return {companies:[]};
    const companies=await tx.list('companies',{id:{$in:ids},status:{$ne:'merged'}},{limit:100});
    return {companies:companies.map(c=>({id:c.id,name:c.name,status:c.status,version:c.version,worksites:[]}))};
  }
  async metrics(u) {
    this.staff(u);const cursor=await this.repo.get('readCursors',u.id+':company.signup');
    const [pending,unread,unassigned,newLabour,pendingChanges,openRoles,companyCount]=await Promise.all([
      this.repo.count('companies',{status:'pending'}),this.repo.count('events',{type:'company.signup',...(cursor?{createdAt:{$gt:cursor.through}}:{})}),
      this.repo.count('users',{kind:'client',status:'active',companyId:null}),this.repo.count('labour',{phase:'new'}),
      this.repo.count('labour',{$or:[{pendingChange:{$ne:null}},{pendingCancel:{$ne:null}}]}),
      this.repo.count('jobs',{status:{$ne:'closed'}}),this.repo.count('companies',{status:{$ne:'merged'}})
    ]);return {pending,unread,unassigned,newLabour,pendingChanges,openRoles,companyCount,actionRequired:pending+unassigned+newLabour+pendingChanges,asOf:this.now()};
  }
  async list(u,kind,query={}) {
    const tx=this.repo;const {page,limit,search}=v.pageInput(query),staff=u.kind==='staff';
    if(['companies','accounts','activity'].includes(kind))this.staff(u);
    const collections={companies:'companies',accounts:'users',labour:'labour',jobs:'jobs',activity:'events',worksites:'worksites'};
    const coll=collections[kind];if(!coll)fail(404,'NOT_FOUND','Unknown collection.');
    const q={};
    if(kind==='companies')q.status={$ne:'merged'};
    if(kind==='jobs'&&(query.excludeClosed===true||query.excludeClosed==='true'))q.status={$ne:'closed'};
    if(kind==='accounts'){q.kind='client';q.status='active';if(query.filter==='unassigned')q.companyId=null;if(query.filter==='assigned')q.companyId={$ne:null};if(query.filter==='pending-login')q.notificationStatus='pending_login';}
    if(!staff)q.companyId=u.companyId||'__unassigned__';else if(query.companyId){const companyId=v.text(query.companyId,'Company ID',80);if(kind==='accounts')q.$or=[{companyId},{requestedCompanyId:companyId}];else q.companyId=companyId;}
    if(query.status&&query.status!=='all'&&kind!=='labour')q[kind==='labour'?'phase':'status']=v.oneOf(query.status,kind==='labour'?['new','info','staffing','filled','cancelled']:kind==='jobs'?['new','sourcing','shortlist','closed']:['pending','active','suspended'],'status');
    const fields={companies:['name','aliases','industry','email','phone'],accounts:['name','email','phone','emailAliases','phoneAliases'],labour:['referenceNumber','role','site.name','site.address'],jobs:['referenceNumber','title','location'],activity:['text','type'],worksites:['name','address']};
    if(search){const matches=fields[kind].map(key=>({[key]:{$regex:v.regexEscape(search),$options:'i'}}));if(q.$or){const companyScope=q.$or;delete q.$or;q.$and=[{$or:companyScope},{$or:matches}];}else q.$or=matches;}
    let rows,total;
    if(kind==='labour'){
      if(query.status&&query.status!=='all')v.oneOf(query.status,['new','info','staffing','filled','cancelled'],'status');
      const result=await tx.labourPage(q,{page,limit,status:query.status,upcoming:query.upcoming===true||query.upcoming==='true',now:this.clock(),companySearch:staff&&search?v.regexEscape(search):''});rows=result.items;total=result.total;
    }else if(staff&&search&&kind==='jobs'){const result=await tx.companySearchPage(coll,q,{page,limit,companySearch:v.regexEscape(search)});rows=result.items;total=result.total;}
    else [rows,total]=await Promise.all([tx.list(coll,q,{limit,skip:(page-1)*limit,sort:{createdAt:-1,id:-1}}),tx.count(coll,q)]);
    let items;
    if(kind==='companies')items=await Promise.all(rows.map(c=>this.companyView(tx,c,true)));
    else if(kind==='accounts')items=rows.map(a=>dto.userDTO(a,true));
    else if(kind==='worksites')items=rows.map(dto.siteDTO);
    else if(kind==='labour')items=rows.map(r=>dto.labourDTO(r,[],staff));
    else if(kind==='jobs')items=await Promise.all(rows.map(j=>this.jobView(tx,j,u)));
    else {const cursor=await tx.get('readCursors',u.id+':company.signup');items=rows.map(e=>dto.eventDTO(e,!!cursor&&e.createdAt<=cursor.through,u.id));}
    return pageResult(items,total,page,limit,{related:staff?await this.relatedCompanies(tx,rows):{companies:[]}});
  }
  async listRecruiters(u) {
    this.staff(u);const rows=await this.repo.list('recruiters',{active:true},{limit:500,sort:{name:1,id:1}});
    return {items:rows.map(r=>({id:r.id,version:r.version,name:r.name,email:r.email,phone:r.phone||'',whatsappPhone:r.whatsappPhone||'',signupNotificationChannels:r.signupNotificationChannels??['email'],active:r.active,userId:r.userId||null,createdAt:r.createdAt,updatedAt:r.updatedAt}))};
  }
  async getCompany(u,id) {
    if(u.kind==='client'&&!u.companyId)return null;
    const c=await this.company(this.repo,u,id);return this.companyView(this.repo,c,u.kind==='staff');
  }
  async getRecord(u,kind,id) {
    const r=await this.record(this.repo,u,kind==='labour'?'labour':'jobs',id),related=await this.relatedCompanies(this.repo,[r]);
    // Staff need the actual requester details alongside the immutable request snapshot.
    if(u.kind==='staff'&&r.accountId){const requester=await this.repo.get('users',r.accountId);related.accounts=requester?.kind==='client'?[dto.userDTO(requester,true)]:[];}
    return {record:kind==='labour'?await this.labourView(this.repo,r,u):await this.jobView(this.repo,r,u),related};
  }
  async listMessages(u,id,query={}) {
    const r=await this.record(this.repo,u,'labour',id),{page,limit}=v.pageInput(query);
    const [items,total]=await Promise.all([this.repo.list('messages',{requestId:r.id},{limit,skip:(page-1)*limit,sort:{createdAt:-1,id:-1}}),this.repo.count('messages',{requestId:r.id})]);
    return pageResult(items.map(m=>({id:m.id,by:m.senderType,name:m.senderName,text:m.text,at:m.createdAt})),total,page,limit);
  }
  async listProfiles(u,id,query={}) {
    const j=await this.record(this.repo,u,'jobs',id),{page,limit}=v.pageInput(query),q={jobId:j.id};if(u.kind!=='staff')q.published=true;
    const rows=await this.repo.list('profiles',q,{limit,skip:(page-1)*limit,sort:{createdAt:1,id:1}});
    return pageResult(dto.jobDTO(j,rows,u.kind==='staff').profiles,await this.repo.count('profiles',q),page,limit);
  }
  async getWorksite(u,id){
    const s=await this.repo.get('worksites',id);if(!s)fail(404,'NOT_FOUND','Worksite not found.');await this.company(this.repo,u,s.companyId);return dto.siteDTO(s);
  }
  async getAccount(u,id){
    this.staff(u);const a=await this.repo.get('users',id);if(!a||a.kind!=='client'||a.status!=='active')fail(404,'NOT_FOUND','Contact not found.');return dto.userDTO(a,true);
  }
  async duplicates(u,query={}){
    this.staff(u);const email=v.email(query.email),phone=v.phone(query.phone);
    const ids=[];for(const [channel,destination] of [['email',email],['sms',phone]]){if(!destination)continue;const identity=await this.repo.get('identities',channel+':'+destination);if(identity)ids.push(identity.userId);}
    const rows=ids.length?await this.repo.list('users',{id:{$in:[...new Set(ids)]},status:'active'},{limit:10}):[];
    return {items:rows.map(a=>dto.userDTO(a,true)),related:await this.relatedCompanies(this.repo,rows)};
  }
  async search(u,query={}) {
    this.staff(u);const q=v.text(query.q||'','Search',100);const page=Number(query.page||1),limit=Number(query.limit||10);
    const result={};for(const kind of ['companies','accounts','labour','jobs','worksites'])result[kind]=await this.list(u,kind,{search:q,page,limit});
    return result;
  }
  async dashboard(u) {
    if(u.kind==='staff'){
      const [metrics,companies,labour,activity]=await Promise.all([this.metrics(u),this.list(u,'companies',{status:'pending',limit:6}),this.list(u,'labour',{limit:3}),this.list(u,'activity',{limit:6})]);
      return {metrics,companies,labour,activity};
    }
    const [labour,jobs]=await Promise.all([this.list(u,'labour',{limit:6,upcoming:true}),this.list(u,'jobs',{limit:6,excludeClosed:true})]);
    const q={companyId:u.companyId||'__unassigned__'};
    const info=await this.repo.labourPage(q,{page:1,limit:1,status:'info',upcoming:true,now:this.clock()});
    const metrics={activeLabour:labour.pagination.total,openRoles:jobs.pagination.total,needInfo:info.total};
    return {labour,jobs,metrics};
  }
}
