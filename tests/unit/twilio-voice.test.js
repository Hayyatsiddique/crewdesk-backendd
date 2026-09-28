import test from 'node:test';
import assert from 'node:assert/strict';
import {createTwilioVoice} from '../../server/src/services/twilio-voice.js';

const config={twilioVoiceEnabled:true,twilioAccountSid:'AC123',twilioAuthToken:'token',twilioVoiceFrom:'+14165550100'};
test('Twilio voice creates an English recruiter call with escaped spoken text',async()=>{let request;const voice=createTwilioVoice(config,{fetchImpl:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({sid:'CA123',status:'queued'})};}});assert.deepEqual(await voice.call('+14165550144','Need 4 <warehouse> workers.'),{sid:'CA123',status:'queued'});assert.match(request.url,/Accounts\/AC123\/Calls\.json$/);assert.equal(request.options.body.get('To'),'+14165550144');assert.equal(request.options.body.get('From'),'+14165550100');assert.match(request.options.body.get('Twiml'),/Need 4 &lt;warehouse&gt; workers\./);assert.equal(request.options.body.get('TimeLimit'),'45');});
test('Twilio voice is inert until explicitly enabled and configured',async()=>{let called=false;const voice=createTwilioVoice({...config,twilioVoiceEnabled:false},{fetchImpl:async()=>{called=true;}});assert.equal(await voice.call('+14165550144','Alert'),false);assert.equal(called,false);});
