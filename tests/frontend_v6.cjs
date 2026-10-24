const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){
  const start=src.indexOf('function '+name+'(');assert(start>=0,name);
  let a=src.indexOf('{',start),depth=0;
  for(let i=a;i<src.length;i++){
    if(src[i]==='{')depth++;
    if(src[i]==='}' && --depth===0)return src.slice(start,i+1);
  }
  throw Error('Incomplete '+name);
}
const nodes={};
const state={demo:null,tick:1000,timelinePlayers:new Set(),selectedPlayers:new Set(),timelineStart:1000,timelineEnd:1500,timelineScope:'match',loadoutHistory:new Map()};
const c=vm.createContext({state,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),$:id=>nodes[id]||(nodes[id]={}),playerName:pid=>state.demo?.players?.[pid]?.name||'unknown',Math});
vm.runInContext("const UTIL_MATCH=/^(flash|smoke|he$|molotov|incendiary|decoy)/i;const PISTOLS=new Set(['glock','hkp2000','usp-s','p250','tec9','fiveseven','cz75a','deagle','revolver','elite','taser']);",c);
vm.runInContext(src.slice(src.indexOf('const PRIMARY_WEAPONS='),src.indexOf('function normalizedLoadout(pid)')),c);
for(const name of ['createPreview','timelineParticipant','timelineKill','timelineUtility','timelineWindowSize','timelineBounds','clampTimelineWindow','currentRoundAt','loadoutAt','bombCarrierAt','normalizedLoadout']){
 vm.runInContext(extract(name),c);
}
const d=vm.runInContext('createPreview()',c);state.demo=d;
for(const l of d.loadouts){if(!state.loadoutHistory.has(l.player))state.loadoutHistory.set(l.player,[]);state.loadoutHistory.get(l.player).push(l);}
assert.equal(d.kills.length,36);
assert.equal(d.bomb_events.filter(e=>e.round===0).length,2);
// An event is represented once, whether attacker/victim are both selected.
let k=d.kills[0];
assert.equal(vm.runInContext('timelineKill(state.demo.kills[0])',c),true);
state.timelinePlayers.add(k.killer);state.timelinePlayers.add(k.victim);
assert.equal(vm.runInContext('timelineKill(state.demo.kills[0])',c),true);
state.timelinePlayers.clear();state.timelinePlayers.add(9);
assert.equal(vm.runInContext('timelineKill(state.demo.kills[0])',c),false);
state.timelinePlayers.clear();state.timelinePlayers.add(0);
assert.equal(vm.runInContext('timelineUtility(state.demo.utility[0])',c),true);
assert.equal(vm.runInContext('timelineUtility(state.demo.utility[1])',c),false);
// Tracker is independent from live map player selection.
state.selectedPlayers.add(6);
assert.equal(vm.runInContext('timelineKill(state.demo.kills[0])',c),true);
assert.equal(state.selectedPlayers.size,1);
console.log('PASS independent timeline player event membership');
// Viewport clamps at demo bounds while remaining zoomable.
const total=d.end-d.start;
vm.runInContext('clampTimelineWindow(state.demo.start-500, state.demo.start+200)',c);
assert.equal(state.timelineStart,d.start);assert(state.timelineEnd-state.timelineStart<total);
vm.runInContext('clampTimelineWindow(state.demo.start, state.demo.end)',c);
assert.equal(state.timelineEnd,d.end);
console.log('PASS timeline viewport clamping and reset range');
state.tick=d.start;
assert.equal(vm.runInContext('bombCarrierAt(state.tick)',c),7);
assert.equal(vm.runInContext('normalizedLoadout(7).hasBomb',c),true);
state.tick=d.start+16*64;
assert.equal(vm.runInContext('bombCarrierAt(state.tick)',c),null);
state.tick=d.start+20*64;
assert.equal(vm.runInContext('bombCarrierAt(state.tick)',c),8);
assert.equal(vm.runInContext('normalizedLoadout(7).hasBomb',c),false);
assert.equal(vm.runInContext('normalizedLoadout(8).hasBomb',c),true);
console.log('PASS bomb pickup / drop / transfer and retained loadout');
state.tick=d.start;
const gear=vm.runInContext('normalizedLoadout(1)',c);
assert(gear.groups.some(x=>x.kind==='primary'));
assert(gear.groups.some(x=>x.kind==='pistol'));
assert(gear.groups.filter(x=>x.kind==='utility').length>=2);
assert(gear.groups.some(x=>x.kind==='equipment'));
console.log('PASS full primary, pistol, utility and equipment entries');
