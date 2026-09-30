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
