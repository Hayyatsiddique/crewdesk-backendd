import assert from 'node:assert/strict';
import test from 'node:test';
import {labourNotificationTiming} from '../../server/src/services/labour-notification-timing.js';

test('formats a weekly client schedule with local shift duration',()=>{
  assert.equal(labourNotificationTiming({
    mode:'weekly',days:[1,2,3,4,5],start:'2026-09-30',startTime:'07:00',endTime:'15:30',site:{zone:'America/Toronto'}
  }),'Schedule: Mon, Tue, Wed, Thu, Fri | Sep 30 - ongoing\n\nShift: 7:00 AM - 3:30 PM\nAmerica/Toronto · 8h 30m before breaks');
});

test('formats a dated range and an overnight shift without changing its local time',()=>{
  assert.equal(labourNotificationTiming({
    mode:'range',start:'2026-09-30',end:'2026-10-04',startTime:'23:30',endTime:'07:30',site:{zone:'America/Toronto'}
  }),'Schedule: Sep 30 - Oct 4\n\nShift: 11:30 PM - 7:30 AM\nAmerica/Toronto · 8h before breaks');
});
