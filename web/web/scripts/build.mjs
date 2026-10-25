import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const pub=path.join(root,'public'), dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
fs.cpSync(pub,dist,{recursive:true});fs.copyFileSync(path.join(root,'index.html'),path.join(dist,'index.html'));
const pkg=path.join(root,'node_modules','demoparser2');
if(!fs.existsSync(pkg))throw Error('Run npm install in web/ first. No WASM library installed.');
const files=[];
function walk(dir){if(!fs.existsSync(dir))return;for(const name of fs.readdirSync(dir)){
 const full=path.join(dir,name),stat=fs.statSync(full);
 if(stat.isDirectory())walk(full);else files.push(full);
}}
walk(pkg);
const js=files.find(f=>path.basename(f)==='demoparser2.js');
const wasm=files.find(f=>path.basename(f)==='demoparser2_bg.wasm');
if(!js||!wasm)throw Error('The installed demoparser2 version lacks the expected browser WASM artifacts. Do not deploy.');
const code=fs.readFileSync(js,'utf8');
if(!code.includes('wasm_bindgen'))throw Error('WASM package is not a compatible no-modules browser build. Do not deploy.');
for(const name of ['parseTicks','parseEvent','parseGrenades','parseHeader']){
 if(!code.includes(name))throw Error('Incompatible WASM export: '+name);
}
const vendor=path.join(dist,'vendor');fs.mkdirSync(vendor,{recursive:true});
fs.copyFileSync(js,path.join(vendor,'demoparser2.js'));
fs.copyFileSync(wasm,path.join(vendor,'demoparser2_bg.wasm'));
const license=files.find(f=>/^license(\.md|\.txt)?$/i.test(path.basename(f)));
if(license)fs.copyFileSync(license,path.join(vendor,'LICENSE-demoparser2.txt'));
console.log('Built static OpenReplay candidate:',dist,'WASM bytes:',fs.statSync(wasm).size);
