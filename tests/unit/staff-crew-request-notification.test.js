import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../../server/src/routes/api.js',import.meta.url),'utf8');

test('new crew request notifications give staff the full address, not only the worksite name',()=>{
  assert.match(api,/const speechLocation=site=>site\?\.address\?\.trim\(\)\|\|'the client worksite';/);
  assert.match(api,/Workers needed: \$\{result\.headcount\}\\nLocation: \$\{location\}\\nSchedule:/);
  assert.match(api,/requested for \$\{location\}\./);
  assert.doesNotMatch(api,/Worksite: \$\{result\.site\.name\}\\nFull address:/);
});

test('crew update emails sent to clients show the full saved address',()=>{
  const confirmation=api.match(/const notifyCrewConfirmation=[\s\S]*?\n  };/)?.[0]||'';
  assert.match(api,/timing=labourNotificationTiming\(record\),location=speechLocation\(record\.site\)/);
  assert.match(api,/Request ID: \$\{record\.referenceNumber\}\\nLocation: \$\{location\}/);
  assert.match(api,/Location: \*\*\$\{location\}\*\*/);
  assert.match(api,/Location: \$\{speechLocation\(result\.site\)\}/);
  assert.doesNotMatch(confirmation,/Worksite: \$\{record\.site\.name\}/);
});
