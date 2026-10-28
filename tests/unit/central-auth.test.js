import test from 'node:test';
import assert from 'node:assert/strict';
import {centralAuthorizeUrl,centralBrowserOrigin,centralCallbackUri} from '../../server/src/services/central-auth.js';
import {loadConfig} from '../../server/src/config/env.js';

const config={
  origin:'https://crewask.com',
  origins:['https://crewask.com','https://crewask.i8ops.com'],
  centralAuthIssuer:'https://central-auth.example',
  centralAuthClientId:'crew-ask',
  centralAuthRedirectUri:'https://crewask.com/api/auth/staff/sso/callback'
};
const request=headers=>({protocol:'https',headers,get(name){return headers[name.toLowerCase()];}});

test('Crew Ask SSO keeps the initiating approved domain for its callback',()=>{
  const req=request({'x-forwarded-host':'crewask.i8ops.com','x-forwarded-proto':'https'});
  assert.equal(centralBrowserOrigin(config,req),'https://crewask.i8ops.com');
  const redirectUri=centralCallbackUri(config,req);
  assert.equal(redirectUri,'https://crewask.i8ops.com/api/auth/staff/sso/callback');
  const authorize=new URL(centralAuthorizeUrl(config,'state','v'.repeat(43),false,redirectUri));
  assert.equal(authorize.searchParams.get('redirect_uri'),redirectUri);
});

test('Crew Ask SSO refuses unapproved return origins',()=>{
  const req=request({origin:'https://attacker.example',referer:'https://attacker.example/staff'});
  assert.equal(centralBrowserOrigin(config,req),'https://crewask.com');
  assert.equal(centralBrowserOrigin(config,req,'https://attacker.example'),'https://crewask.com');
});

test('production always trusts both official Crew Ask frontend origins',()=>{
  const loaded=loadConfig({NODE_ENV:'production',PUBLIC_ORIGIN:'https://crewask.com',ALLOWED_ORIGINS:'https://crewask.com',MONGODB_URI:'mongodb://example',AUTH_SECRET:'s'.repeat(48),OTP_PROVIDER:'live'});
  assert.ok(loaded.origins.includes('https://crewask.com'));
  assert.ok(loaded.origins.includes('https://crewask.i8ops.com'));
});
