import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
if(fs.existsSync('.env'))throw new Error('.env already exists. It was not overwritten.');
const template=fs.readFileSync('.env.example','utf8');
fs.writeFileSync('.env',template.replace(/^AUTH_SECRET=$/m,'AUTH_SECRET='+randomBytes(48).toString('hex')),{flag:'wx',mode:0o600});
console.log('Created .env with a random authentication secret.');
console.log('Set MONGODB_URI as needed, and ADMIN_EMAIL (plus optional ADMIN_PHONE) before npm run admin:create.');
console.log('Keep .env private; do not commit or share it.');
