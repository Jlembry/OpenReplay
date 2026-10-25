import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
const root=import.meta.dirname;
const dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true}); fs.mkdirSync(dist,{recursive:true});
await build({
  entryPoints:[path.join(root,'src/probe-worker.js')],
  bundle:true,platform:'browser',format:'esm',target:'es2022',
  outfile:path.join(dist,'probe-worker.js'),logLevel:'info',
  legalComments:'eof'
});
fs.copyFileSync(path.join(root,'index.html'),path.join(dist,'index.html'));
console.log('Built isolated browser-parser probe:',dist);
