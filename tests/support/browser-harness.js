/** Explicit TEST-ONLY HTTP adapter, not the Express/MongoDB production runtime. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './fixtures.js';
import {csrfSecurity,cookieName,sessionResponse} from '../../server/src/middleware/security.js';
import {userDTO} from '../../server/src/domain/serializers.js';
if(process.env.CREWDESK_TEST_HARNESS!=='1'||process.env.NODE_ENV==='production')throw new Error('This fixture harness is test-only. Set CREWDESK_TEST_HARNESS=1 explicitly.');
const f=await fixture(new Date());
const config={production:false,secret:'x'.repeat(64),origins:['http://127.0.0.1:5081']},csrf=csrfSecurity(config),client=path.resolve(fileURLToPath(new URL('../../client/',import.meta.url)));
const {domain,auth}=f;
const server=http.createServer(async(req,res)=>{
  f.advance(Date.now()-f.clock().getTime());
  const url=new URL(req.url,'http://127.0.0.1:5081'),parts=url.pathname.split('/').filter(Boolean),portal=req.headers['x-portal']==='staff'?'staff':'client';
  req.get=name=>req.headers[name.toLowerCase()];req.cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s)).filter(x=>x[0]&&x[1]));
  res.cookie=(name,value,options={})=>{const prior=res.getHeader('Set-Cookie')||[];res.setHeader('Set-Cookie',[...prior,`${name}=${value}; Path=/; HttpOnly; SameSite=Strict${options.expires?'; Expires='+options.expires.toUTCString():''}`]);};
  res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  const send=data=>res.json({data});
  try{
    if(url.pathname==='/__test/otp'){res.json({code:f.codes.get(url.searchParams.get('contact'))});return;}
    if(url.pathname==='/health'){res.json({status:'test-fixture',database:'in-memory-test-double'});return;}
    if(url.pathname==='/socket.io/socket.io.js'){res.setHeader('Content-Type','application/javascript');res.end('// Socket.IO not installed in this TEST FIXTURE.\n');return;}
    if(parts[0]!=='api'){
      let filename=url.pathname==='/'?'client-desktop.html':/^\/client(?:\/|$)/.test(url.pathname)?'client-desktop.html':/^\/client-mobile(?:\/|$)/.test(url.pathname)?'client-mobile.html':/^\/staff(?:\/|$)/.test(url.pathname)?'staff-backend.html':decodeURIComponent(url.pathname.slice(1));const full=path.resolve(client,filename);
      if(!full.startsWith(client+path.sep))throw Object.assign(new Error('Not found'),{status:404});
      const bytes=await fs.readFile(full);res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':'text/html');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'");res.end(bytes);return;
    }
    let raw='';for await(const chunk of req)raw+=chunk;if(raw.length>131072)throw Object.assign(new Error('Too large'),{status:413});const body=raw?JSON.parse(raw):{},q=Object.fromEntries(url.searchParams),method=req.method;
    if(url.pathname==='/api/auth/csrf'){csrf.issue(req,res);return;}
    await new Promise((resolve,reject)=>csrf.check(req,res,e=>e?reject(e):resolve()));
    if(parts[1]==='auth'){
      if(parts[2]==='client'&&parts[3]==='request-otp'){send(await auth.requestOtp(body,'browser'));return;}
      if(parts[2]==='client'&&parts[3]==='verify-otp'){send(sessionResponse(res,await auth.verifyOtp(body,'browser'),config));return;}
      if(parts[2]==='staff'&&parts[3]==='request-otp'){send(await auth.requestStaffOtp(body,'browser'));return;}
      if(parts[2]==='staff'&&parts[3]==='verify-otp'){send(sessionResponse(res,await auth.verifyStaffOtp(body,'browser'),config));return;}
      if(parts[2]==='staff'&&parts[3]==='login'){send(sessionResponse(res,await auth.staffLogin(body,'browser'),config));return;}
      if(parts[2]==='logout'){await auth.logout(req.cookies[cookieName(portal,false)],portal);res.cookie(cookieName(portal,false),'',{expires:new Date(0)});send({signedOut:true});return;}
      if(parts[2]==='me'){const s=await auth.authenticate(req.cookies[cookieName(portal,false)],portal);send({user:userDTO(s.user,s.user.kind==='staff'),expiresAt:s.session.expiresAt});return;}
    }
    const kind=parts[1],user=(await auth.authenticate(req.cookies[cookieName(kind,false)],kind)).user,name=parts[2],id=parts[3],action=parts[4];
    if(method==='GET'){
      if(name==='dashboard')send(await domain.dashboard(user));
      else if(name==='metrics')send(await domain.metrics(user));
      else if(name==='recruiters')send(await domain.listRecruiters(user));
      else if(name==='search')send(await domain.search(user,q));
      else if(name==='worksites'&&id)send(await domain.getWorksite(user,id));
      else if(name==='company')send(await domain.getCompany(user));
      else if(name==='account')send(userDTO(user));
      else if(name==='accounts'&&id==='duplicates')send(await domain.duplicates(user,q));
      else if(name==='accounts'&&id)send(await domain.getAccount(user,id));
      else if(name==='companies'&&id)send(await domain.getCompany(user,id));
      else if(name==='labour'&&action==='messages')send(await domain.listMessages(user,id,q));
      else if(name==='jobs'&&action==='profiles')send(await domain.listProfiles(user,id,q));
      else if(['labour','jobs'].includes(name)&&id)send(await domain.getRecord(user,name,id));
      else send(await domain.list(user,name,q));return;
    }
    let command,resource=id;
    if(name==='companies'){
      if(id==='merge'){command='company.merge';resource='';}
      else if(action==='status')command='company.status';
      else if(action==='worksites'){command=parts[5]?'site.update':'site.create';resource=parts[5]||id;}
      else command='company.update';
    }else if(name==='accounts'){command=id==='merge'?'account.merge':action==='link'?'account.link':'account.create';if(id==='merge')resource='';}
    else if(name==='worksites')command=id?'site.update':'site.create';
    else if(name==='events')command='events.read';
    else if(name==='labour')command=({'accept':'labour.accept','confirm':'labour.confirm','messages':'labour.message','internal-note':'labour.note','change-request':'labour.change','cancellation-request':'labour.cancel','resolve-change':'labour.resolve'})[action]||'labour.create';
    else if(name==='jobs')command=({'status':'job.status','internal-note':'job.note','profiles':'job.profile'})[action]||'job.create';
    send(await domain.execute(user,command,body,resource||'',{key:req.get('Idempotency-Key'),route:url.pathname}));
  }catch(error){res.statusCode=error.status||500;res.json({error:{message:error.message,code:error.code||'ERROR'}});if(res.statusCode>=500)console.error(error);}
});
server.listen(5081,'127.0.0.1',()=>console.log('TEST FIXTURE ONLY: http://127.0.0.1:5081'));
