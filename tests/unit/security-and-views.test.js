import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../support/fixtures.js';
import {csrfSecurity,cookieOptions,cookieName,csrfCookie} from '../../server/src/middleware/security.js';
import {labourPipeline} from '../../server/src/repositories/labour-pipeline.js';
const config={production:true,secret:'s'.repeat(64),origins:['https://crewdesk.example.test']};
function issue(portal='client',jar={}){let value,cookie;const security=csrfSecurity(config),req={cookies:jar,get:name=>name==='X-Portal'?portal:undefined};security.issue(req,{cookie:(name,token,options)=>cookie={name,token,options},json:body=>value=body.data.csrfToken});return {security,value,cookie};}
test('production cookies are Secure, HttpOnly, SameSite Strict and host scoped',()=>{assert.deepEqual(cookieOptions(config),{secure:true,httpOnly:true,sameSite:'strict',path:'/'});assert.equal(cookieName('client',true),'__Host-cd_client');assert.equal(cookieName('staff',true),'__Host-cd_staff');});
test('staff/admin sessions are independent per device and expire exactly after 90 days',async()=>{
  const f=await fixture(),started=f.clock().getTime(),desktop=await f.auth.session(f.repo,f.staff),mobile=await f.auth.session(f.repo,f.staff);
  assert.notEqual(desktop.token,mobile.token);
  assert.equal(Date.parse(desktop.expiresAt)-started,90*24*60*60*1000);
  assert.equal(Date.parse(mobile.expiresAt)-started,90*24*60*60*1000);
  await f.auth.authenticate(desktop.token,'staff');await f.auth.authenticate(mobile.token,'staff');
  f.advance(90*24*60*60*1000);
  await assert.rejects(()=>f.auth.authenticate(desktop.token,'staff'),e=>e.code==='SESSION_EXPIRED');
  await assert.rejects(()=>f.auth.authenticate(mobile.token,'staff'),e=>e.code==='SESSION_EXPIRED');
});
test('valid CSRF tokens are portal-bound and remain stable when another tab opens',()=>{const r=issue();assert.ok(r.security.valid('client',r.value,r.cookie.token));assert.equal(r.security.valid('staff',r.value,r.cookie.token),false);const second=issue('client',{[r.cookie.name]:r.cookie.token});assert.equal(second.value,r.value);});
test('CSRF rejects missing tokens and untrusted origins',()=>{const r=issue();for(const origin of ['https://attacker.example','https://crewdesk.example.test']){let error;r.security.check({method:'POST',cookies:{},get:name=>({'Origin':origin,'X-Portal':'client'}[name])},{},e=>error=e);assert.equal(error.status,403);}});
test('malformed non-ASCII CSRF cookie fails without a timing-safe comparison exception',()=>{const r=issue();const malformed=r.cookie.token.slice(0,-1)+'\u00e9';assert.equal(r.security.valid('client',r.value,malformed),false);});
test('valid CSRF state-changing request is accepted; safe GET does not need token',()=>{const r=issue();let error;r.security.check({method:'POST',cookies:{[csrfCookie('client',true)]:r.cookie.token},get:n=>({'X-Portal':'client','Origin':config.origins[0],'X-CSRF-Token':r.value}[n])},{},e=>error=e);assert.equal(error,undefined);let called=false;r.security.check({method:'GET'},{},()=>called=true);assert.ok(called);});
test('worksite direct reads are tenant scoped, including a selected site beyond page one',async()=>{const f=await fixture();const site=await f.domain.getWorksite(f.a,f.site.id);assert.equal(site.id,f.site.id);await assert.rejects(()=>f.domain.getWorksite(f.b,f.site.id),e=>e.status===404);assert.equal((await f.domain.getWorksite(f.staff,f.site.id)).name,site.name);});
test('recurring list Filled filter follows the next scheduled date, not only stored phase',async()=>{const f=await fixture();let r=await f.domain.execute(f.a,'labour.create',{...f.crew,mode:'range',end:'2026-09-25'});r=await f.domain.execute(f.staff,'labour.confirm',{version:r.version,date:'2026-09-23',count:10},r.id);assert.equal(r.phase,'staffing');assert.equal((await f.domain.list(f.a,'labour',{status:'filled'})).pagination.total,1);f.advance(48*3600000);assert.equal((await f.domain.list(f.a,'labour',{status:'filled'})).pagination.total,0);assert.equal((await f.domain.list(f.a,'labour',{status:'staffing'})).pagination.total,1);});
test('dashboard excludes completed schedules and closed roles without hiding history',async()=>{const f=await fixture();await f.domain.execute(f.a,'labour.create',f.crew);let j=await f.domain.execute(f.a,'job.create',f.job);await f.domain.execute(f.staff,'job.status',{version:j.version,status:'closed'},j.id);f.advance(3*86400000);const home=await f.domain.dashboard(f.a);assert.equal(home.labour.pagination.total,0);assert.equal(home.jobs.pagination.total,0);assert.equal((await f.domain.list(f.a,'labour')).pagination.total,1);assert.equal((await f.domain.list(f.a,'jobs')).pagination.total,1);});
test('MongoDB list pipeline keeps tenant match first, paginates on server and removes computed fields',()=>{const p=labourPipeline({companyId:'company-a'},{page:3,limit:25,status:'filled',now:new Date('2026-09-22')});assert.deepEqual(p[0],{$match:{companyId:'company-a'}});assert.ok(p.some(x=>x.$match?.__phase==='filled'));assert.deepEqual(p.at(-1).$facet.items[1],{$skip:50});assert.ok(p.at(-1).$facet.items.at(-1).$unset.includes('__confirmed'));});
test('staff inbox search includes company names and retains escaped, tenant-scoped client search',async()=>{
  const f=await fixture();await f.domain.execute(f.a,'labour.create',f.crew);await f.domain.execute(f.a,'job.create',f.job);
  assert.equal((await f.domain.list(f.staff,'labour',{search:'Company Alpha'})).pagination.total,1);
  assert.equal((await f.domain.list(f.staff,'jobs',{search:'Company Alpha'})).pagination.total,1);
  assert.equal((await f.domain.list(f.staff,'jobs',{search:'.*'})).pagination.total,0);
  assert.equal((await f.domain.list(f.b,'labour',{search:'Warehouse'})).pagination.total,0);
});
