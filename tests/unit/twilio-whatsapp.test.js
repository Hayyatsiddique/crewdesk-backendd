import test from 'node:test';
import assert from 'node:assert/strict';
import {createTwilioWhatsApp} from '../../server/src/services/twilio-whatsapp.js';

const config={twilioWhatsAppEnabled:true,twilioAccountSid:'AC123',twilioAuthToken:'token',twilioWhatsAppFrom:'whatsapp:+14165550100'};

test('Twilio WhatsApp sends from and to channel addresses through the Message resource',async()=>{
  let request;const sender=createTwilioWhatsApp(config,{fetchImpl:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({sid:'SM123',status:'queued'})};}});
  assert.deepEqual(await sender.send('+14165550144','Crew confirmed.'),{sid:'SM123',status:'queued'});
  assert.match(request.url,/Accounts\/AC123\/Messages\.json$/);
  assert.equal(request.options.body.get('From'),'whatsapp:+14165550100');
  assert.equal(request.options.body.get('To'),'whatsapp:+14165550144');
  assert.equal(request.options.body.get('Body'),'Crew confirmed.');
});

test('Twilio WhatsApp remains inert until enabled and fully configured',async()=>{
  assert.equal(await createTwilioWhatsApp({}).send('+14165550144','Ignored'),false);
});
