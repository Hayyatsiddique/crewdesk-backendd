import test from 'node:test';
import assert from 'node:assert/strict';
import {createOtpProvider} from '../../server/src/services/otp-provider.js';

test('live email OTP uses configured SMTP with STARTTLS',async()=>{
  let transportConfig,message;
  const config={otpProvider:'live',smtpHost:'smtp.gmail.com',smtpPort:587,smtpSecure:false,smtpUser:'sender@example.test',smtpPassword:'app-password',emailFrom:'sender@example.test'};
  const provider=createOtpProvider(config,{createTransport:options=>{
    transportConfig=options;
    return {sendMail:async value=>{message=value;}};
  }});
  await provider.send({channel:'email',to:'client@example.test',code:'123456'});
  assert.deepEqual(transportConfig.auth,{user:'sender@example.test',pass:'app-password'});
  assert.equal(transportConfig.host,'smtp.gmail.com');
  assert.equal(transportConfig.port,587);
  assert.equal(transportConfig.secure,false);
  assert.equal(transportConfig.requireTLS,true);
  assert.deepEqual({from:message.from,to:message.to,subject:message.subject,text:message.text},{from:'sender@example.test',to:'client@example.test',subject:'Your Crew Ask verification code',text:'Your Crew Ask code is 123456. It expires in five minutes. Do not share this code.'});
  assert.match(message.html,/Crew Ask/);assert.match(message.html,/123456/);assert.match(message.html,/Do not share it/);
});

test('live email OTP fails closed when SMTP is unconfigured or rejects delivery',async()=>{
  const incomplete=createOtpProvider({otpProvider:'live'},{createTransport:()=>{throw new Error('transport should not be created');}});
  await assert.rejects(()=>incomplete.send({channel:'email',to:'client@example.test',code:'123456'}),/Email provider is not configured/);
  const configured={otpProvider:'live',smtpHost:'smtp.gmail.com',smtpPort:587,smtpSecure:false,smtpUser:'sender@example.test',smtpPassword:'password',emailFrom:'sender@example.test'};
  const rejected=createOtpProvider(configured,{createTransport:()=>({sendMail:async()=>{throw new Error('SMTP rejected delivery');}})});
  await assert.rejects(()=>rejected.send({channel:'email',to:'client@example.test',code:'123456'}),/SMTP rejected delivery/);
});

test('live SMS OTP uses the configured Aircall number and Basic Auth',async()=>{
  let request;
  const config={otpProvider:'live',aircallApiId:'api-id',aircallApiToken:'api-token',aircallNumberId:'1324930'};
  const provider=createOtpProvider(config,{fetchImpl:async(url,options)=>{request={url,options};return {ok:true};}});
  await provider.send({channel:'sms',to:'+14165550123',code:'123456'});
  assert.equal(request.url,'https://api.aircall.io/v1/numbers/1324930/messages/send');
  assert.equal(request.options.method,'POST');
  assert.equal(request.options.headers.Authorization,'Basic '+Buffer.from('api-id:api-token').toString('base64'));
  assert.equal(request.options.headers.Accept,'application/json');
  assert.equal(request.options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(request.options.body),{to:'+14165550123',body:'Your Crew Ask verification code is 123456. It expires in 5 minutes. Do not share it.'});
});

test('live SMS OTP fails closed when Aircall is unconfigured or rejects delivery',async()=>{
  const incomplete=createOtpProvider({otpProvider:'live'},{fetchImpl:async()=>{throw new Error('fetch should not run');}});
  await assert.rejects(()=>incomplete.send({channel:'sms',to:'+14165550123',code:'123456'}),/SMS provider is not configured/);
  const configured=createOtpProvider({otpProvider:'live',aircallApiId:'id',aircallApiToken:'token',aircallNumberId:'1'},{fetchImpl:async()=>({ok:false})});
  await assert.rejects(()=>configured.send({channel:'sms',to:'+14165550123',code:'123456'}),/OTP provider rejected delivery/);
});
