// Performance optimizations must preserve exact event values and seeking behavior.
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`${name} present`);
  const end=source.indexOf('\n}',start);
  assert(end>start,`${name} closes`);
  return source.slice(start,end+2);
}
const state={demo:null,tick:0,selectedPlayers:new Set(),eventPlayer:'all',utilityPlayers:new Set(),selectedUtilityTypes:new Set(['smoke','flash','he','fire','decoy']),
  flashIntervals:[],lastFrameCache:null,lastRosterCache:null,lastCarrierCache:null,lastBombCache:null,
  loadoutHistory:new Map(),loadoutViewCache:new Map(),playerHistories:[],frameTicks:[],scoreSort:{key:null,direction:null}};
const ctx=vm.createContext({state,console,clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),Math});
const names=['currentRoundAt','buildRoundScores','buildReplayIndexes','cumulativeValue','roundHasDeath','statFallback','rosterAt','tickFrameAt','playerVisible','utilityTypeVisible','roundKills','roundUtility','flashRemaining'];
for(const name of names)vm.runInContext(extract(name),ctx);
const d={tick_rate:64,sample_stride:8,start:0,end:320,players:Array.from({length:4},(_,i)=>({id:String(i),name:'P'+i})),
  rounds:[{number:1,start:0,stop:159,end:159,freeze:0,winner:'CT'},{number:2,start:160,stop:320,end:320,freeze:160,winner:'T'}],
  kills:[{tick:12,round:0,killer:0,victim:1,assister:2},{tick:33,round:0,killer:0,victim:3},{tick:181,round:1,killer:1,victim:0,assister:2},{tick:243,round:1,killer:2,victim:3}],
  utility:[{tick:5,start:5,end:64,round:0,type:'flash',owner:0,damage:[],blinded:[{player:1,duration:2.1}]}],
  damage_events:[{tick:14,attacker:0,damage:4},{tick:18,attacker:0,damage:9},{tick:199,attacker:1,damage:12}],
  blinds:[{tick:40,player:1,thrower:0,enemy:true},{tick:49,player:3,thrower:0,enemy:false}],
  frames:[]};
for(let t=0;t<=320;t+=8){
  const side=t<160?3:2;
  d.frames.push([t,Array.from({length:4},(_,i)=>[i,t+i,t-i,0,i<2?side:(side===3?2:3),-1,100,0,0,0,0,0,800])]);
}
state.demo=d;
state.frameTicks=d.frames.map(f=>f[0]);
state.playerHistories=d.players.map(()=>[]);
for(const [tick,players] of d.frames)for(const p of players)state.playerHistories[p[0]].push([tick,p]);
vm.runInContext('buildReplayIndexes(state.demo)',ctx);
function naive(key,pid,tick){
  if(key==='kills_total')return d.kills.filter(k=>k.tick<=tick&&k.killer===pid&&k.killer!==k.victim).length;
  if(key==='deaths_total')return d.kills.filter(k=>k.tick<=tick&&k.victim===pid).length;
  if(key==='assists_total')return d.kills.filter(k=>k.tick<=tick&&k.assister===pid).length;
  if(key==='utility_damage_total')return d.damage_events.filter(e=>e.tick<=tick&&e.attacker===pid).reduce((a,e)=>a+e.damage,0);
  if(key==='enemies_flashed_total')return d.blinds.filter(b=>b.tick<=tick&&b.thrower===pid&&b.enemy===true).length;
}
for(const tick of [0,12,33,40,100,220,181,319,1,320,241,0]){
  state.tick=tick;
  for(const key of ['kills_total','deaths_total','assists_total','utility_damage_total','enemies_flashed_total'])
    for(let pid=0;pid<4;pid++){
      const expected=naive(key,pid,tick);
      const got=vm.runInContext(`statFallback(${pid},${JSON.stringify(key)},${tick})`,ctx);
      assert.equal(got,expected,`seek ${tick}: ${key}/${pid}`);
    }
  const ri=tick<160?0:1;
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('roundKills()',ctx))).map(k=>k.id),d.kills.map((k,id)=>({k,id})).filter(({k})=>k.round===ri).map(({id})=>id));
  assert.equal(vm.runInContext('rosterAt(state.tick)',ctx).find(p=>p[0]===1)[6],tick>=12&&tick<160?0:100);
  assert.equal(vm.runInContext('tickFrameAt(state.tick)',ctx).length,4);
}
state.selectedPlayers.add(0);
assert.equal(vm.runInContext('roundUtility()',ctx).length,1);
state.selectedPlayers.clear();
state.tick=200;
assert.equal(vm.runInContext('roundUtility()',ctx).length,0);
const data2=JSON.parse(JSON.stringify(d));
vm.runInContext('buildRoundScores(state.demo)',ctx);
assert.equal(d.finalScore[0]+d.finalScore[1],2);
assert.equal(d.rounds[0].scoreBefore[0]+d.rounds[0].scoreBefore[1],0);
assert.equal(d.rounds[1].scoreAfter[0]+d.rounds[1].scoreAfter[1],2);
console.log('PASS indexed counters, time seeks/rewinds, death states, round indexes and round scores');
