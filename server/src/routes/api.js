import {Router} from 'express';
import nodemailer from 'nodemailer';
import {crewAskEmail} from '../services/email-template.js';
import {createClientNotifier} from '../services/client-notifier.js';
import {createPushNotifier} from '../services/push-notifier.js';
import {createTwilioVoice} from '../services/twilio-voice.js';
import {createTwilioWhatsApp} from '../services/twilio-whatsapp.js';
import {labourNotificationTiming} from '../services/labour-notification-timing.js';
import {read,command} from '../controllers/api.js';
import {validate} from '../validators/http.js';
import {authenticate,portalOf,cookieName,cookieOptions,sessionResponse} from '../middleware/security.js';
import {userDTO} from '../domain/serializers.js';
export function apiRoutes({domain,auth,config,csrf,getIO=()=>null}){
  const root=Router(),a=Router();root.use('/auth',a);
  let mailer;
  const clientNotifier=createClientNotifier(config);
  const pushNotifier=createPushNotifier(config);
  const twilioVoice=createTwilioVoice(config);
  const twilioWhatsApp=createTwilioWhatsApp(config);
  const emailReady=()=>!!(config.smtpHost&&config.smtpUser&&config.smtpPassword&&config.emailFrom);
  const transport=()=>mailer??=nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpSecure,requireTLS:!config.smtpSecure,auth:{user:config.smtpUser,pass:config.smtpPassword}});
  const emailMessage=(to,subject,text,path)=>({from:config.emailFrom,to,subject,text,html:crewAskEmail({preheader:subject,heading:subject.replace(/^Crew Ask:\s*/,''),body:text,actionLabel:'Open Crew Ask',actionUrl:config.origin+path})});
  const speechDate=value=>{const [year,month,day]=String(value||'').split('-').map(Number);return Number.isInteger(year)&&Number.isInteger(month)&&Number.isInteger(day)?new Intl.DateTimeFormat('en-CA',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,month-1,day))):String(value||'the requested date');};
  const speechLocation=site=>site?.address?.trim()||'the client worksite';
  const notifyRecruiter=async(recruiter,channels=['email'],subject,text,path='/staff',voiceText='')=>{
    const selected=new Set(channels||[]),message={subject,text,path},attempts=[];
    if(selected.has('email')&&recruiter?.email)attempts.push(clientNotifier.email(recruiter.email,message));
    if(selected.has('sms')&&recruiter?.phone)attempts.push(clientNotifier.sms(recruiter.phone,message));
    if(selected.has('whatsapp')&&(recruiter?.whatsappPhone||recruiter?.phone))attempts.push(twilioWhatsApp.send(recruiter.whatsappPhone||recruiter.phone,text));
    if(selected.has('voice')&&recruiter?.phone)attempts.push((async()=>{const call=await twilioVoice.call(recruiter.phone,voiceText||text);if(call)try{await domain.audit(domain.repo,null,'voice.call_requested','Twilio voice alert requested for '+recruiter.name+'.',null,null,{provider:'twilio',callSid:call.sid,status:call.status,recruiterId:recruiter.id});}catch{}return Boolean(call);})());
    const results=await Promise.allSettled(attempts);
    return results.some(result=>result.status==='fulfilled'&&result.value);
  };
  const notifyCompanyRecruiter=async(companyId,subject,text,voiceText='')=>{
    const company=await domain.repo.get('companies',companyId),ids=company?.recruiterIds?.length?company.recruiterIds:(company?.recruiterId?[company.recruiterId]:[]);if(!ids.length)return false;
    const results=await Promise.all(ids.map(async id=>{try{return await notifyRecruiter(await domain.repo.get('recruiters',id),company.recruiterNotifications?.[id]??['email'],subject,text,'/staff',voiceText);}catch{return false;}}));return results.some(Boolean);
  };
  const notifyRecruiterTeam=async(subject,text,path='/staff',voiceText='')=>{
    const channels=['email',...(config.twilioVoiceNewCompany?['voice']:[])],recruiters=await domain.repo.list('recruiters',{active:true},{limit:500,sort:{name:1,id:1}}),sent=await Promise.allSettled(recruiters.map(recruiter=>notifyRecruiter(recruiter,channels,subject,text,path,voiceText)));
    return sent.filter(result=>result.status==='fulfilled'&&result.value).length;
  };
  const notifyPush=async(users,message)=>{
    if(!pushNotifier.enabled()||!users.length)return 0;
    const subscriptions=await domain.repo.list('pushSubscriptions',{userId:{$in:users.map(user=>user.id)}},{limit:500}),result=await pushNotifier.send(subscriptions,message);
    if(result.expired.length)await Promise.allSettled(result.expired.map(id=>domain.repo.removeWhere('pushSubscriptions',{id})));
    return result.sent;
  };
  const notifyClientPush=(users,message)=>notifyPush(users,message);
  const notifyStaffPush=async message=>notifyPush(await domain.repo.list('users',{kind:'staff',status:'active'},{limit:100}),message);
  const notifyClientWhatsApp=async(users,text)=>{
    if(!config.twilioWhatsAppClientNotifications||!twilioWhatsApp.ready())return 0;
    const results=await Promise.allSettled(users.filter(user=>user.phone).map(user=>twilioWhatsApp.send(user.phone,text)));
    return results.filter(result=>result.status==='fulfilled'&&result.value).length;
  };
  const notifyCompanyClients=async(companyId,subject,text,path='/client')=>{
    const users=await domain.repo.list('users',{companyId,kind:'client',status:'active',notificationStatus:{$ne:'pending_login'}},{limit:100});
    const emails=emailReady()?await Promise.allSettled(users.filter(user=>user.email).map(user=>transport().sendMail(emailMessage(user.email,subject,text,path)))):[];
    await notifyClientPush(users,{title:subject,body:text,path});
    await notifyClientWhatsApp(users,text);
    return emails.filter(result=>result.status==='fulfilled').length;
  };
  const notifyCrewConfirmation=async(record,date,count,workers)=>{
    const users=await domain.repo.list('users',{companyId:record.companyId,kind:'client',status:'active',notificationStatus:{$ne:'pending_login'}},{limit:100});
    const crew=workers||'Crew names will be available in the secure request view.',timing=labourNotificationTiming(record),location=speechLocation(record.site);
    const fullyConfirmed=count===record.headcount,subject=`Crew Ask: ${record.role} — crew ${fullyConfirmed?'fully ':''}confirmed`,text=`Your crew request has been updated for ${date}.\n\nJob / crew role: ${record.role}\nRequest ID: ${record.referenceNumber}\nLocation: ${location}\n\n${timing}\n\n${count} of ${record.headcount} workers are confirmed.\n\nConfirmed crew and phone numbers:\n${crew}\n\nOpen Crew Ask to review the crew details and contact information.`,htmlText=`Your crew request has been updated for **${date}**.\n\nJob / crew role: **${record.role}**\nRequest ID: **${record.referenceNumber}**\nLocation: **${location}**\n\n${timing}\n\n**${count} of ${record.headcount} workers are confirmed.**\n\nConfirmed crew and phone numbers:\n${crew.split('\n').map((worker,index)=>`${index+1}. **${worker.replace(' — ','** — **')}**`).join('\n')}\n\nOpen Crew Ask to review the crew details and contact information.`,path='/client/labour/'+encodeURIComponent(record.referenceNumber);
    const delivery=await clientNotifier.completion(users,{subject,text,htmlText,path}),whatsapp=await notifyClientWhatsApp(users,text);
    const push=await notifyClientPush(users,{title:subject,body:`${count} of ${record.headcount} ${record.role} workers are confirmed. Open Crew Ask to view the crew.`,path});
    return {...delivery,whatsapp,push};
  };
  root.get('/',read(()=>({
    service:'Crew Ask API',
    version:'0.1.0',
    status:'ok',
    authentication:'Secure session cookie plus CSRF token',
    start:{health:'/health',csrf:'/api/auth/csrf',session:'/api/auth/me'},
    documentation:'https://github.com/Hayyatsiddique/crewdesk/blob/main/docs/MOBILE_API.md'
  })));
  a.get('/csrf',csrf.issue);
  a.get('/push/public-key',read(()=>({enabled:pushNotifier.enabled(),publicKey:pushNotifier.publicKey()})));
  a.post('/client/request-otp',validate('otp'),read(req=>auth.requestOtp(req.body,req.ip)));
  a.post('/client/verify-otp',validate('verify'),async(req,res,next)=>{try{const value=await auth.verifyOtp(req.body,req.ip);await auth.logout(req.cookies[cookieName('client',config.production)],'client');if(value.createdCompany)try{const subject='Crew Ask: new company awaiting review',text=`${value.createdCompany.name} has created a company account and is awaiting approval.`;await Promise.all([notifyRecruiterTeam(subject,`Hello team,\n\n${text}\n\nReview the company profile, confirm its details, then activate or place it on hold.`, '/staff/#companies?pending',`Marks H R alert. A new company account, ${value.createdCompany.name}, is awaiting review. Please open the Marks H R staff dashboard.`),notifyStaffPush({title:subject,body:text,path:'/staff/companies?pending'})]);}catch{}res.json({data:sessionResponse(res,value,config)});}catch(error){next(error);}});
  a.post('/staff/request-otp',validate('staffOtp'),read(req=>auth.requestStaffOtp(req.body,req.ip)));
  a.post('/staff/verify-otp',validate('verify'),async(req,res,next)=>{try{const value=await auth.verifyStaffOtp(req.body,req.ip);await auth.logout(req.cookies[cookieName('staff',config.production)],'staff');res.json({data:sessionResponse(res,value,config)});}catch(error){next(error);}});
  a.get('/me',authenticate(auth,config),read(req=>({user:userDTO(req.user,req.user.kind==='staff'),expiresAt:req.authSession.expiresAt})));
  a.post('/logout',async(req,res,next)=>{try{const portal=portalOf(req),token=req.cookies[cookieName(portal,config.production)];let sid;try{sid=(await auth.authenticate(token,portal)).session.id;}catch{}await auth.logout(token,portal);if(sid)getIO()?.in('session:'+sid).disconnectSockets(true);res.clearCookie(cookieName(portal,config.production),cookieOptions(config));res.json({data:{signedOut:true}});}catch(error){next(error);}});
  for(const kind of ['staff','client']){
    const r=Router();root.use('/'+kind,authenticate(auth,config,kind),r);
    r.get('/dashboard',read(req=>domain.dashboard(req.user)));
    r.get('/worksites/:id',read(req=>domain.getWorksite(req.user,req.params.id)));
    r.post('/push/subscriptions',validate('push.subscribe'),read(async req=>{const subscription=await domain.savePushSubscription(req.user,req.body);return {enabled:pushNotifier.enabled(),subscriptionId:subscription.id};}));
    if(kind==='client'){
      r.get('/company',read(req=>domain.getCompany(req.user)));
      r.get('/account',read(req=>userDTO(req.user)));
      r.get('/worksites',read(req=>domain.list(req.user,'worksites',req.query)));
      r.post('/worksites',validate('site.create'),command(domain,'site.create',{created:true}));
      r.patch('/worksites/:id',validate('site.update'),command(domain,'site.update'));
      r.post('/labour',validate('labour.create'),read(async req=>{const result=await domain.execute(req.user,'labour.create',req.body,'',{route:req.baseUrl+req.route.path}),company=await domain.repo.get('companies',result.companyId),companyName=company?.name||'A client company',location=speechLocation(result.site),schedule=result.end&&result.end!==result.start?`${result.start} to ${result.end}`:result.start,subject=`Crew Ask: ${result.role} — new crew request`,text=`Hello,\n\n${req.user.name} submitted a crew request.\n\nCompany: ${companyName}\nRequest ID: ${result.id}\nJob / crew role: ${result.role}\nWorkers needed: ${result.headcount}\nLocation: ${location}\nSchedule: ${schedule}\nShift: ${result.startTime} - ${result.endTime}\n\nSign in to Crew Ask staff workspace to review it.`,sent=await notifyCompanyRecruiter(result.companyId,subject,text,`Marks H R recruiter alert. Company: ${companyName}. Crew request for ${result.role}. Workers needed: ${result.headcount}. Location: ${location}. Start date: ${speechDate(result.start)}. Start time: ${result.startTime}. Please open the Marks H R staff dashboard.`),staffPush=await notifyStaffPush({title:subject,body:`${companyName}: ${result.headcount} ${result.role} requested for ${location}.`,path:'/staff/labour/'+encodeURIComponent(result.id)});return {...result,recruiterNotificationSent:sent,staffPush};}));
      r.post('/labour/:id/change-request',validate('labour.change'),command(domain,'labour.change'));
      r.post('/labour/:id/cancellation-request',validate('labour.cancel'),command(domain,'labour.cancel'));
      r.post('/jobs',validate('job.create'),read(async req=>{const result=await domain.execute(req.user,'job.create',req.body,'',{route:req.baseUrl+req.route.path}),company=await domain.repo.get('companies',result.companyId),companyName=company?.name||'A client company',subject=`Crew Ask: ${result.title} — new job request`,text=`Hello,\n\n${req.user.name} submitted a new job request.\n\nCompany: ${companyName}\nJob title: ${result.title}\nRequest ID: ${result.id}\nOpenings: ${result.openings}\nFull address / location: ${result.location}\nPeriod: ${result.start} to ${result.end}\n\nSign in to Crew Ask staff workspace to review it.`,sent=await notifyCompanyRecruiter(result.companyId,subject,text,`Marks H R recruiter alert. Company: ${companyName}. New job request. Job title: ${result.title}. Openings: ${result.openings}. Location: ${result.location}. Start date: ${speechDate(result.start)}. End date: ${speechDate(result.end)}. Please open the Marks H R staff dashboard.`),staffPush=await notifyStaffPush({title:subject,body:`${companyName} submitted ${result.title}.`,path:'/staff/job/'+encodeURIComponent(result.id)});return {...result,recruiterNotificationSent:sent,staffPush};}));
    }else{
      r.get('/metrics',read(req=>domain.metrics(req.user)));
      r.get('/search',read(req=>domain.search(req.user,req.query)));
      r.get('/recruiters',read(req=>domain.listRecruiters(req.user)));
      r.post('/recruiters',validate('recruiter.create'),command(domain,'recruiter.create',{created:true}));
      r.patch('/recruiters/:id/contact',validate('recruiter.contact'),command(domain,'recruiter.contact'));
      r.post('/recruiters/:id/remove',validate('recruiter.remove'),command(domain,'recruiter.remove'));
      for(const name of ['companies','accounts','activity','worksites'])r.get('/'+name,read(req=>domain.list(req.user,name,req.query)));
      r.post('/companies/merge',validate('company.merge'),command(domain,'company.merge'));
      r.get('/companies/:id',read(req=>domain.getCompany(req.user,req.params.id)));
      r.patch('/companies/:id',validate('company.update'),command(domain,'company.update'));
      r.patch('/companies/:id/status',validate('company.status'),read(async req=>{const before=await domain.repo.get('companies',req.params.id),result=await domain.execute(req.user,'company.status',req.body,req.params.id,{route:req.baseUrl+req.route.path});if(before?.status!==result.status)try{await notifyCompanyClients(result.id,`Crew Ask: company ${result.status==='active'?'activated':'on hold'}`,result.status==='active'?`Your company ${result.name} is active. You can now submit crew requests and job posts.`:`Your company ${result.name} has been placed on hold. Contact Crew Ask if you need help.`);}catch{}return result;}));
      r.patch('/companies/:id/recruiter',validate('company.recruiter'),read(async req=>{const result=await domain.execute(req.user,'company.recruiter',req.body,req.params.id,{route:req.baseUrl+req.route.path});await Promise.allSettled((req.body.recruiterIds||[]).map(async recruiterId=>{const recruiter=await domain.repo.get('recruiters',recruiterId),channels=(result.recruiterNotifications?.[recruiterId]??['email']).filter(channel=>channel!=='voice');await notifyRecruiter(recruiter,channels,'Crew Ask: company assigned',`Hello ${recruiter.name},\n\nYou have been assigned to ${result.name}. Sign in to Crew Ask staff workspace for request details.`);}));return result;}));
      r.post('/companies/:id/worksites',validate('site.create'),command(domain,'site.create',{created:true}));
      r.patch('/companies/:companyId/worksites/:id',validate('site.update'),async(req,res,next)=>{try{const site=await domain.repo.get('worksites',req.params.id);if(!site||site.companyId!==req.params.companyId)return res.status(404).json({error:{code:'NOT_FOUND',message:'Worksite not found.'}});next();}catch(error){next(error);}},command(domain,'site.update'));
      r.get('/accounts/duplicates',read(req=>domain.duplicates(req.user,req.query)));
      r.get('/accounts/:id',read(req=>domain.getAccount(req.user,req.params.id)));
      r.post('/accounts',validate('account.create'),command(domain,'account.create',{created:true}));
      r.post('/accounts/merge',validate('account.merge'),command(domain,'account.merge'));
      r.post('/accounts/:id/link',validate('account.link'),command(domain,'account.link'));
      r.post('/events/mark-read',validate('events.read'),command(domain,'events.read'));
      r.post('/labour/:id/confirm',validate('labour.confirm'),read(async req=>{const before=await domain.record(domain.repo,req.user,'labour',req.params.id),result=await domain.execute(req.user,'labour.confirm',req.body,req.params.id,{route:req.baseUrl+req.route.path}),record=await domain.record(domain.repo,req.user,'labour',req.params.id);const previousCount=Number(before.fills?.[req.body.date]||0),workers=(record.workers?.[req.body.date]||[]).map(worker=>[worker.name,worker.phone].filter(Boolean).join(' — ')).filter(Boolean).join('\n');let clientNotificationSent=0,clientCompletionNotification={email:0,sms:0,whatsapp:0,push:0};if(before.version!==result.version&&previousCount!==req.body.count)try{clientCompletionNotification=await notifyCrewConfirmation(record,req.body.date,req.body.count,workers);clientNotificationSent=clientCompletionNotification.email;}catch{}return {...result,clientNotificationSent,clientCompletionNotification};}));
      r.patch('/labour/:id/recruiter',validate('labour.recruiter'),read(async req=>{const result=await domain.execute(req.user,'labour.recruiter',req.body,req.params.id,{route:req.baseUrl+req.route.path}),record=await domain.record(domain.repo,req.user,'labour',req.params.id);await Promise.allSettled((req.body.recruiterIds||[]).map(async recruiterId=>{const recruiter=await domain.repo.get('recruiters',recruiterId),channels=(result.recruiterNotifications?.[recruiterId]??['email']).filter(channel=>channel!=='voice');await notifyRecruiter(recruiter,channels,`Crew Ask: ${record.role} — request assigned`,`Hello ${recruiter.name},\n\nJob / crew role: ${record.role}\nRequest ID: ${record.referenceNumber}\nWorkers needed: ${record.headcount}\nWorksite: ${record.site.name}\n\nSign in to Crew Ask staff workspace for details.`);}));return result;}));
      r.post('/labour/:id/accept',validate('labour.accept'),read(async req=>{const before=await domain.record(domain.repo,req.user,'labour',req.params.id),result=await domain.execute(req.user,'labour.accept',req.body,'',{route:req.baseUrl+req.route.path});let clientNotificationSent=0;if(before.phase!==result.phase)try{clientNotificationSent=await notifyCompanyClients(result.companyId,`Crew Ask: ${result.role} — request accepted`,`Your crew request has been accepted by the Crew Ask team.\n\nJob / crew role: ${result.role}\nRequest ID: ${result.referenceNumber}\nLocation: ${speechLocation(result.site)}\n\n${labourNotificationTiming(result)}\n\nWe are now staffing ${result.headcount} people. You will receive another update when crew members are confirmed.`, '/client/labour/'+encodeURIComponent(result.referenceNumber));}catch{}return {...result,clientNotificationSent};}));
      r.patch('/labour/:id/internal-note',validate('labour.note'),command(domain,'labour.note'));
      r.post('/labour/:id/resolve-change',validate('labour.resolve'),read(async req=>{const result=await domain.execute(req.user,'labour.resolve',req.body,req.params.id,{route:req.baseUrl+req.route.path});const type=result.phase==='cancelled'?'cancellation':'change request',decision=req.body.approve?'approved':'declined';let clientNotificationSent=0;try{clientNotificationSent=await notifyCompanyClients(result.companyId,`Crew Ask: ${result.role} — ${type} ${decision}`,`Hello,\n\nJob / crew role: ${result.role}\nRequest ID: ${result.referenceNumber}\nLocation: ${speechLocation(result.site)}\n\n${labourNotificationTiming(result)}\n\nYour ${type} has been ${decision} by the Crew Ask team.\n\n${req.body.approve&&result.phase==='cancelled'?'The crew request is now cancelled.':'Sign in to Crew Ask to view the current request details.'}`);}catch{}return {...result,clientNotificationSent};}));
      r.patch('/jobs/:id/status',validate('job.status'),read(async req=>{const before=await domain.record(domain.repo,req.user,'jobs',req.params.id),beforeProfiles=await domain.listProfiles(req.user,req.params.id,{page:1,limit:100}),result=await domain.execute(req.user,'job.status',req.body,req.params.id,{route:req.baseUrl+req.route.path});let clientNotificationSent=0;const changed=before.status!==result.status,publishedCount=result.profiles.filter(profile=>profile.published).length,shortlistShared=result.status==='shortlist'&&publishedCount>beforeProfiles.items.filter(profile=>profile.published).length;if((changed&&['sourcing','closed'].includes(result.status))||shortlistShared)try{const jobName=`Job title: ${result.title}\nRequest ID: ${result.referenceNumber}\n\n`,message=jobName+(result.status==='sourcing'?`Your hiring request has been accepted by the Crew Ask team.\n\nWe have started sourcing for ${result.title}. We will notify you when screened candidates are ready to review.`:result.status==='closed'?`Your hiring request has been completed by the Crew Ask team.\n\nOpen Crew Ask to review the request history.`:`Screened candidates are ready.\n\n${publishedCount} candidate ${publishedCount===1?'profile is':'profiles are'} now available in your secure role view.`);clientNotificationSent=await notifyCompanyClients(result.companyId,`Crew Ask: ${result.title}`,message, '/client/job/'+encodeURIComponent(result.referenceNumber));}catch{}return {...result,clientNotificationSent};}));
      for(const [suffix,method,action] of [['internal-note','patch','job.note'],['profiles','post','job.profile']])r[method]('/jobs/:id/'+suffix,validate(action),command(domain,action));
    }
    for(const name of ['labour','jobs']){
      r.get('/'+name,read(req=>domain.list(req.user,name,req.query)));
      r.get('/'+name+'/:id',read(req=>domain.getRecord(req.user,name,req.params.id)));
    }
    r.post('/labour/:id/messages',validate('labour.message'),command(domain,'labour.message'));
    r.get('/labour/:id/messages',read(req=>domain.listMessages(req.user,req.params.id,req.query)));
    r.get('/jobs/:id/profiles',read(req=>domain.listProfiles(req.user,req.params.id,req.query)));
  }
  return root;
}
