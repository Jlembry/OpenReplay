const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){
 const start=src.indexOf('function '+name+'(');assert(start>=0,name);
 const brace=src.indexOf('{',start);let depth=0;
 for(let i=brace;i<src.length;i++){
  if(src[i]==='{')depth++;
  if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);
 }
 throw Error('unclosed '+name);
}
const state={demo:{rounds:[{start:100},{start:500}]},tick:650,roundKillTicks:new Map([
 ['0:2',[180,240]],['1:2',[550,700]],['1:3',[610]]]),
 viewW:900,viewH:600,zoom:2,panX:45,panY:-35,selectedPlayers:new Set(),selectedKill:0,selectedUtility:0};
let updates=0;let message='';
const context=vm.createContext({state,Math,Set,Map,canvas:{},
 updatePlayerFilter:()=>updates++,notify:(m)=>message=m,
 tickFrameAt:()=>[[2,600,320,0,3],[3,800,400,0,2]],
 worldToRadar:p=>[p[1],p[2]]});
for(const name of ['currentRoundAt','isStacked','sceneCenterY','sceneHeight','baseScale','inverseCamera','radarToScreen','roundKillCount',
 'playersInScreenRect','commitRadarSelection'])vm.runInContext(extract(name),context);
function run(js){return vm.runInContext(js,context)}
assert.equal(run('roundKillCount(2,499)'),2);
assert.equal(run('roundKillCount(2,500)'),0,'new round badge starts at zero');
assert.equal(run('roundKillCount(2,699)'),1);
assert.equal(run('roundKillCount(2,700)'),2);
assert.equal(run('roundKillCount(3,620)'),1);
console.log('PASS player skull badge is current-round count at exact tick');
const position=run('radarToScreen(600,320)');
const inverse=run(`inverseCamera(${position.x},${position.y})`);
assert(Math.abs(inverse.x-600)<1e-9 && Math.abs(inverse.y-320)<1e-9,'pan/zoom coordinate roundtrip');
run(`commitRadarSelection(${position.x-18},${position.y-18},${position.x+18},${position.y+18})`);
assert.equal(state.selectedPlayers.size,1);
assert(state.selectedPlayers.has(2));
assert.equal(state.selectedKill,-1);
assert.equal(updates,1);
assert.match(message,/1 player selected/);
console.log('PASS region selection correctly transforms with zoom & pan and updates map filter');
run('commitRadarSelection(-10000,-10000,-9990,-9990)');
assert.equal(state.selectedPlayers.size,1,'missing region should not silently show everyone');
console.log('PASS empty selection safely keeps previous map filter');
assert(src.includes("event.shiftKey?'select':event.ctrlKey?'draw':'pan'"));
assert(src.includes("event.code==='Backspace'"));
assert(src.includes('paintRadarAnnotations();'));
assert(src.includes("state.radarStrokes=[];state.dragPointer=null"));
console.log('PASS drawing shortcuts and map-anchored rendering are wired');
