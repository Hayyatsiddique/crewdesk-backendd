import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientNotifier} from '../../server/src/services/client-notifier.js';

const config={origin:'https://crew.example',smtpHost:'smtp.example',smtpPort:587,smtpSecure:false,smtpUser:'user',smtpPassword:'secret',emailFrom:'updates@crew.example',aircallApiId:'id',aircallApiToken:'token',aircallNumberId:'number'};
const message={subject:'Crew Ask: crew fully confirmed',text:'Your crew is confirmed.',path:'/client/labour/CR-1001'};

test('completion notification delivers email and SMS independently',async()=>{
  const email=[],sms=[];
  const notifier=createClientNotifier(config,{createTransport:()=>({sendMail:async value=>email.push(value)}),fetchImpl:async(_url,options)=>{sms.push(JSON.parse(options.body));return {ok:true};}});
  const result=await notifier.completion([{email:'client@example.test',phone:'+14165550144'}],message);
  assert.deepEqual(result,{email:1,sms:1});
  assert.equal(email[0].to,'client@example.test');
  assert.match(email[0].html,/https:\/\/crew\.example\/client\/labour\/CR-1001/);
  assert.deepEqual(sms,[{to:'+14165550144',body:'Your crew is confirmed.'}]);
});

test('one failed delivery channel does not block the other',async()=>{
  const notifier=createClientNotifier(config,{createTransport:()=>({sendMail:async()=>{throw Error('SMTP unavailable');}}),fetchImpl:async()=>({ok:true})});
  assert.deepEqual(await notifier.completion([{email:'client@example.test',phone:'+14165550144'}],message),{email:0,sms:1});
});
