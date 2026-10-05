/** Real Express/Mongoose/Socket.IO integration. No memory repository or skipped fallback. */
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import mongoose from 'mongoose';
import pino from 'pino';
import request from 'supertest';
import {io as clientSocket} from 'socket.io-client';
import {MongoRepository,initializeDatabase} from '../../server/src/repositories/mongo.js';
import {CrewDeskService} from '../../server/src/domain/service.js';
import {AuthService} from '../../server/src/domain/auth.js';
import {csrfSecurity} from '../../server/src/middleware/security.js';
import {createApp} from '../../server/src/app.js';
import {attachSockets} from '../../server/src/sockets/index.js';
import {today,plusDay} from '../../server/src/domain/validation.js';

const uri=process.env.TEST_MONGODB_URI;
if(!uri)throw new Error('TEST_MONGODB_URI is required. Use a dedicated TEST replica set, not production.');
// MongoDB caps database names at 38 bytes. Keep the dedicated random test
// database well below that limit so teardown can always remove it safely.
const dbName='cdt_'+randomUUID().replaceAll('-','').slice(0,16);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result=response=>response.body.data;

test('real MongoDB, HTTP and websocket integration', {timeout:120000}, async t=>{
  let server,sockets;
  try{
    await mongoose.connect(uri,{dbName,autoIndex:false,serverSelectionTimeoutMS:10000});
    const hello=await mongoose.connection.db.admin().command({hello:1});
    assert.ok(hello.setName||hello.msg==='isdbgrid','Transactions require a replica set.');
    await initializeDatabase();
    const repo=new MongoRepository(),domain=new CrewDeskService(repo),codes=new Map();
    const config={production:false,port:5000,origin:'http://localhost:5000',origins:['http://localhost:5000'],trustProxy:0,secret:randomBytes(48).toString('hex'),sessionHours:12};
    const logger=pino({level:'silent'}),csrf=csrfSecurity(config);
    const auth=new AuthService(repo,domain,{secret:config.secret,provider:{send:async({to,code})=>codes.set(to,code)}});
    const fixture=await repo.transaction(async tx=>{
      const make=async(name,kind,companyId)=>{
        const u=await tx.insert('users',{name,kind,email:name+'@example.test',normalizedEmail:name+'@example.test',phone:'',normalizedPhone:'',emailAliases:[],phoneAliases:[],companyId,status:'active',authVersion:0});
        await domain.claimIdentity(tx,'email',u.email,u.id,true);return u;
      };
      let ca=await domain.createCompany(tx,{name:'Integration Alpha'}),cb=await domain.createCompany(tx,{name:'Integration Beta'});
      ca.status=cb.status='active';ca=await tx.save('companies',ca);cb=await tx.save('companies',cb);
      return {ca,cb,staff:await make('staff','staff',null),a:await make('alice','client',ca.id),b:await make('bob','client',cb.id)};
    });
    const app=createApp({domain,auth,config,logger,csrf,getIO:()=>sockets?.io,isReady:()=>mongoose.connection.readyState===1});
    server=http.createServer(app);sockets=attachSockets(server,{auth,config,csrf,logger});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const socketUrl='http://127.0.0.1:'+server.address().port;
    async function login(portal,email){
      const agent=request.agent(app),jar=new Map();
      const collect=res=>{for(const cookie of res.headers['set-cookie']||[]){const first=cookie.split(';')[0],i=first.indexOf('=');jar.set(first.slice(0,i),first.slice(i+1));}return res;};
      const tokenResponse=collect(await agent.get('/api/auth/csrf').set('X-Portal',portal).expect(200)),token=result(tokenResponse).csrfToken;
      const call=(method,path,body,key=randomUUID())=>{
        let q=agent[method]('/api'+path).set('X-Portal',portal).set('Origin',config.origin).set('X-CSRF-Token',token).set('Idempotency-Key',key);
        if(body!==undefined)q=q.send(body);return q;
      };
      let response;
      if(portal==='staff'){
        const challenge=result(await call('post','/auth/staff/request-otp',{channel:'email',contact:email}).expect(200));
        response=await call('post','/auth/staff/verify-otp',{challengeId:challenge.challengeId,code:codes.get(email)}).expect(200);
      }
      else{
        const challenge=result(await call('post','/auth/client/request-otp',{channel:'email',contact:email,intent:'signin'}).expect(200));
        assert.equal('code' in challenge,false);
        response=await call('post','/auth/client/verify-otp',{challengeId:challenge.challengeId,code:codes.get(email)}).expect(200);
      }
      collect(response);return {agent,call,token,jar,user:result(response).user};
    }
    const staff=await login('staff',fixture.staff.email),a=await login('client',fixture.a.email),b=await login('client',fixture.b.email);
    let site,r,j;
    const start=plusDay(today('America/Toronto'),1);
    const siteBody={name:'Integration yard',address:'100 Test Street',zone:'America/Toronto',contactName:'Alice',contactPhone:'+14165550144',notes:'Gate 2',ppe:[]};
    const crewBody=()=>({role:'Warehouse associate',headcount:10,siteId:site.id,mode:'range',start,end:plusDay(start,2),days:[],dates:[],startTime:'23:00',endTime:'07:00',equipment:'',tickets:['WHMIS'],licences:[],ppe:[],contactName:'Alice',contactPhone:'+14165550144',notes:'Night shift'});
    await t.test('real session cookies, CSRF and staff separation',async()=>{
      assert.ok(a.jar.has('cd_client'));assert.ok(staff.jar.has('cd_staff'));
      assert.equal(result(await a.call('get','/auth/me').expect(200)).user.kind,'client');
      await a.call('get','/staff/companies').expect(401);
      await a.agent.post('/api/client/worksites').send(siteBody).expect(403);
      await a.agent.post('/api/client/worksites').set('X-CSRF-Token',a.token).set('Origin','https://attacker.example').send(siteBody).expect(403);
    });
    await t.test('worksite persistence, ownership and strict mass-assignment rejection',async()=>{
      site=result(await a.call('post','/client/worksites',siteBody).expect(200));
      assert.equal((await new MongoRepository().get('worksites',site.id)).companyId,fixture.ca.id);
      await b.call('get','/client/worksites/'+site.id).expect(404);
      await a.call('post','/client/labour',{...crewBody(),companyId:fixture.cb.id}).expect(400);
    });
    await t.test('idempotent submissions and independent repository reload',async()=>{
      const key=randomUUID();r=result(await a.call('post','/client/labour',crewBody(),key).expect(200));
      const retry=result(await a.call('post','/client/labour',crewBody(),key).expect(200));
      assert.deepEqual(retry,r);assert.equal(r.id,'CR-1001');assert.notEqual(r.id,r._id);
      assert.equal(await repo.count('labour'),1);assert.equal((await new MongoRepository().get('labour',r._id)).referenceNumber,r.id);
      await b.call('get','/client/labour/'+r.id).expect(404);
      await b.call('post','/client/labour/'+r.id+'/messages',{text:'Unauthorized'}).expect(404);
    });
    await t.test('per-date confirmations, Mongo aggregation filters and stale writes',async()=>{
      r=result(await staff.call('post','/staff/labour/'+r.id+'/accept',{version:r.version}).expect(200));
      const stale=r.version;
      r=result(await staff.call('post','/staff/labour/'+r.id+'/confirm',{version:r.version,date:start,count:10}).expect(200));
      assert.equal(r.phase,'staffing');assert.equal(r.fills[start],10);
      const page=result(await a.call('get','/client/labour?status=filled&limit=1').expect(200));
      assert.equal(page.pagination.total,1);assert.equal(page.items[0].id,r.id);assert.equal('__phase' in page.items[0],false);
      assert.equal(result(await staff.call('get','/staff/labour?search=Integration%20Alpha').expect(200)).pagination.total,1);
      await staff.call('patch','/staff/labour/'+r.id+'/internal-note',{version:stale,text:'Stale'}).expect(409);
      r=result(await staff.call('patch','/staff/labour/'+r.id+'/internal-note',{version:r.version,text:'PRIVATE_DISPATCH_NOTE'}).expect(200));
      const visible=await a.call('get','/client/labour/'+r.id).expect(200);assert.equal(JSON.stringify(visible.body).includes('PRIVATE_DISPATCH_NOTE'),false);
    });
    await t.test('real database transactions preserve historical site snapshots',async()=>{
      await a.call('patch','/client/worksites/'+site.id,{...siteBody,address:'200 Changed Street',version:site.version}).expect(200);
      assert.equal((await repo.get('labour',r._id)).site.address,'100 Test Street');
      await assert.rejects(()=>repo.transaction(async tx=>{await tx.insert('worksites',{...siteBody,companyId:fixture.ca.id});throw Error('rollback-check');}),/rollback-check/);
      assert.equal(await repo.count('worksites'),1);
    });
    await t.test('draft profiles are hidden; shortlist publishes only after staff action',async()=>{
      j=result(await a.call('post','/client/jobs',{title:'Warehouse lead',description:'Lead a team safely.',start,end:plusDay(start,30),location:'Toronto',workType:'Permanent',openings:1,licences:[]}).expect(200));
      await staff.call('patch','/staff/jobs/'+j.id+'/status',{version:j.version,status:'shortlist'}).expect(422);
      j=result(await staff.call('post','/staff/jobs/'+j.id+'/profiles',{version:j.version,name:'Sam Example',summary:'Screened',resumeText:'RESUME_ONLY_AFTER_PUBLISH'}).expect(200));
      assert.equal(result(await a.call('get','/client/jobs/'+j.id).expect(200)).record.profiles.length,0);
      j=result(await staff.call('patch','/staff/jobs/'+j.id+'/status',{version:j.version,status:'shortlist'}).expect(200));
      assert.equal(result(await a.call('get','/client/jobs/'+j.id).expect(200)).record.profiles.length,1);
    });
    await t.test('real Socket.IO invalidation is scoped to authorized company',async()=>{
      const connect=client=>new Promise((resolve,reject)=>{
        const socket=clientSocket(socketUrl,{transports:['websocket'],forceNew:true,reconnection:false,auth:{portal:'client',csrfToken:client.token},extraHeaders:{Origin:config.origin,Cookie:[...client.jar].map(([k,v])=>k+'='+v).join('; ')},timeout:5000});
        socket.once('connect',()=>resolve(socket));socket.once('connect_error',reject);
      });
      const sa=await connect(a),sb=await connect(b),other=[];sb.on('invalidate',e=>other.push(e));sb.emit('join','company:'+fixture.ca.id);
      try{
        const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket invalidation timeout')),8000);sa.on('invalidate',e=>{if(e.type==='labour.message'){clearTimeout(timer);resolve(e);}});});
        await delay(300);
        await staff.call('post','/staff/labour/'+r.id+'/messages',{text:'Socket delivery test'}).expect(200);
        const event=await received;assert.equal('text' in event,false);assert.equal('companyId' in event,false);await delay(250);assert.equal(other.length,0);
      }finally{sa.disconnect();sb.disconnect();}
    });
    await t.test('pending change remains separate; approval resets confirmations',async()=>{
      r=result(await a.call('get','/client/labour/'+r.id).expect(200)).record;
      r=result(await a.call('post','/client/labour/'+r.id+'/change-request',{version:r.version,headcount:12,startTime:'22:00',endTime:'06:00',reason:'Need two more workers'}).expect(200));
      assert.equal(r.headcount,10);assert.equal(r.fills[start],10);
      r=result(await staff.call('post','/staff/labour/'+r.id+'/resolve-change',{version:r.version,pendingId:r.pendingChange.id,approve:true}).expect(200));assert.equal(r.headcount,12);assert.deepEqual(r.fills,{});
    });
    await t.test('company hold prevents submissions and merge preserves snapshots',async()=>{
      const current=result(await staff.call('get','/staff/companies/'+fixture.ca.id).expect(200));
      await staff.call('patch','/staff/companies/'+current.id+'/status',{version:current.version,status:'suspended'}).expect(200);
      await a.call('post','/client/labour',crewBody()).expect(422);
      const source=result(await staff.call('get','/staff/companies/'+fixture.ca.id).expect(200)),target=result(await staff.call('get','/staff/companies/'+fixture.cb.id).expect(200));
      await staff.call('post','/staff/companies/merge',{sourceId:source.id,targetId:target.id,sourceVersion:source.version,targetVersion:target.version,confirm:true}).expect(200);
      assert.equal((await repo.get('labour',r._id)).companyId,fixture.cb.id);assert.equal((await repo.get('labour',r._id)).site.address,'100 Test Street');
      await a.call('get','/auth/me').expect(401);
    });
  }finally{
    await sockets?.close();
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    // Never drop the URI's named database. Only the random database allocated above is eligible.
    if(mongoose.connection.readyState===1&&mongoose.connection.name===dbName&&dbName.startsWith('crewdesk_test_'))await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
