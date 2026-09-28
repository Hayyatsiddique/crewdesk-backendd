import test from 'node:test';
import assert from 'node:assert/strict';
import {crewAskEmail} from '../../server/src/services/email-template.js';

test('branded email template escapes notification content and includes an optional action',()=>{const html=crewAskEmail({heading:'New company',body:'A <new> company & contact',actionLabel:'Review company',actionUrl:'https://crew.ask/staff'});assert.match(html,/Crew Ask/);assert.match(html,/A &lt;new&gt; company &amp; contact/);assert.match(html,/Review company/);assert.doesNotMatch(html,/A <new> company/);});
