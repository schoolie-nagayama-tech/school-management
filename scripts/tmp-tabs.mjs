#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const GWS = 'C:\\Users\\ytaka\\AppData\\Roaming\\npm\\gws.cmd';
function gws(args) {
  const quoted = args.map(a => (a.startsWith('{')||a.includes(' ')||a.includes('"')) ? '"'+a.replace(/"/g,'\\"')+'"' : a);
  for (let i=0;i<5;i++) {
    const r = spawnSync('cmd.exe', ['/c', GWS, ...quoted], { encoding: 'utf8', maxBuffer: 20*1024*1024, windowsVerbatimArguments: true });
    if (r.status === 0) return r;
    if (r.stderr && r.stderr.includes('Quota')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45000); continue; }
    return r;
  }
}
const SID = process.argv[2];
const r = gws(['sheets','spreadsheets','get','--params', JSON.stringify({ spreadsheetId: SID, fields: 'sheets.properties.title' })]);
console.log(r.stdout);
if (r.status !== 0) console.error('stderr:', r.stderr);
