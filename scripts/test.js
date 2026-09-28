/** No shell globs: the same test command works on Windows, macOS and Linux. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const kind=process.argv[2];
if(!['unit','integration'].includes(kind))throw new Error('Choose unit or integration.');
const root=fileURLToPath(new URL('../',import.meta.url)),folder=path.join(root,'tests',kind);
const files=fs.readdirSync(folder).filter(name=>name.endsWith('.test.js')).sort().map(name=>path.join(folder,name));
if(!files.length)throw new Error('No tests found.');
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',env:process.env});
if(result.error)throw result.error;
process.exitCode=result.status??1;
