#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const PARENT = process.argv[2];
if (!PARENT) { console.error('usage: node list-folder-children.mjs <folderId>'); process.exit(1); }

const GWS_CMD = 'C:\\Users\\ytaka\\AppData\\Roaming\\npm\\gws.cmd';
function gws(args) {
  const quoted = args.map(a => {
    if (a.startsWith('{') || a.includes(' ') || a.includes('"')) {
      return '"' + a.replace(/"/g, '\\"') + '"';
    }
    return a;
  });
  const r = spawnSync('cmd.exe', ['/c', GWS_CMD, ...quoted], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsVerbatimArguments: true });
  if (r.status !== 0) { console.error('stderr:', r.stderr); throw new Error('gws failed'); }
  const out = r.stdout || '';
  const jsonStart = out.indexOf('{');
  if (jsonStart < 0) { console.error('no JSON:', out.slice(0,400)); return {}; }
  return JSON.parse(out.slice(jsonStart));
}

const res = gws([
  'drive','files','list',
  '--params', JSON.stringify({
    q: `'${PARENT}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
    fields: 'files(id,name)',
    pageSize: 200,
  }),
]);
console.log(JSON.stringify(res.files || [], null, 2));
