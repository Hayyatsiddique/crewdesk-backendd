import test from 'node:test';
import assert from 'node:assert/strict';
import {createPushNotifier} from '../../server/src/services/push-notifier.js';

const config={pushVapidSubject:'mailto:operations@crew.example',pushVapidPublicKey:'public-key',pushVapidPrivateKey:'private-key'};

test('browser push sends a safe payload and identifies expired subscriptions for cleanup',async()=>{
  const sent=[],client={setVapidDetails:(...args)=>assert.deepEqual(args,[config.pushVapidSubject,config.pushVapidPublicKey,config.pushVapidPrivateKey]),sendNotification:async(subscription,payload,options)=>{sent.push({subscription,payload:JSON.parse(payload),options});if(subscription.endpoint==='https://push.example/expired')throw {statusCode:410};}};
  const notifier=createPushNotifier(config,{client}),result=await notifier.send([{id:'live',endpoint:'https://push.example/live',keys:{p256dh:'key',auth:'auth'}},{id:'expired',endpoint:'https://push.example/expired',keys:{p256dh:'key',auth:'auth'}}],{title:'Crew Ask: request confirmed',body:'One worker is confirmed.',path:'/client/labour/CR-1001'});
  assert.equal(notifier.publicKey(),config.pushVapidPublicKey);
  assert.deepEqual(result,{sent:1,expired:['expired']});
  assert.deepEqual(sent[0].payload,{title:'Crew Ask: request confirmed',body:'One worker is confirmed.',path:'/client/labour/CR-1001'});
  assert.equal(sent[0].options.TTL,86400);
});

test('browser push stays disabled without VAPID configuration',async()=>{
  const notifier=createPushNotifier({});
  assert.equal(notifier.enabled(),false);
  assert.deepEqual(await notifier.send([],{title:'Ignored',body:'Ignored'}),{sent:0,expired:[]});
});
