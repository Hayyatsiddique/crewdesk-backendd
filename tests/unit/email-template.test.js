import test from 'node:test';
import assert from 'node:assert/strict';
import {crewAskEmail} from '../../server/src/services/email-template.js';

test('branded email template escapes notification content and includes an optional action',()=>{const html=crewAskEmail({heading:'New company',body:'A <new> company & contact',actionLabel:'Review company',actionUrl:'https://crew.ask/staff'});assert.match(html,/Crew Ask/);assert.match(html,/A &lt;new&gt; company &amp; contact/);assert.match(html,/Review company/);assert.doesNotMatch(html,/A <new> company/);});

test('branded email emphasizes explicit important values and operational labels safely',()=>{const html=crewAskEmail({heading:'Warehouse associate — crew fully confirmed',body:'Request ID: **CR-1013**\nConfirmed crew: **Steven Louiss** — **+176543432**'});assert.match(html,/<strong>Request ID:<\/strong>/);assert.match(html,/<strong>CR-1013<\/strong>/);assert.match(html,/<strong>Steven Louiss<\/strong>/);});
