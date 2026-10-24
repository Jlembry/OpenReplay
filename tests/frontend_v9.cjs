const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){const start=src.indexOf('function '+name+'(');assert(start>=0,name);let a=src.indexOf('{',start),depth=0;for(let i=a;i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);}throw Error(name);}
const nodes={},state={demo:null,tick:0,timelineScope:'match',timelineStart:0,timelineEnd:1,scoreSort:{key:null,direction:null},playing:true,
  playerRoundPresence:[],enemyDamageByPlayer:new Map(),trajectoryEffects:new Map(),selectedPlayers:new Set()};
let strokes=0;
const ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){strokes++;},stroke(){},arc(){},fill(){},setLineDash(){}};
const context=vm.createContext({state,$:id=>nodes[id]||(nodes[id]={classList:{toggle(){}}}),clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),
    Math,console,ctx,renderTimeline(){},radarPoint:p=>[p[0],p[1]],radarLabel(){},playerName:pid=>state.demo?.players?.[pid]?.name||'Unknown',TAU:Math.PI*2,UTIL_LABELS:{smoke:'SMOKE'}});
for(const name of ['createPreview','currentRoundAt','timelineBounds','timelineWindowSize','clampTimelineWindow','setTimelineWindow',
    'resetTimeline','updateTimelineScopeButtons','setTimelineScope','playerADR','playerVisible','trajectorySegment','utilityTypeVisible','paintTrajectories',
    'scoreboardValue','sortedScoreboardEntries'])vm.runInContext(extract(name),context);
const d=vm.runInContext('createPreview()',context);state.demo=d;state.tick=d.start;
state.playerRoundPresence=d.players.map(()=>new Set([...d.rounds.keys()]));
for(const e of d.enemy_damage_events){let arr=state.enemyDamageByPlayer.get(e.attacker)||[];arr.push(e);state.enemyDamageByPlayer.set(e.attacker,arr);}
for(const [pid,hits] of state.enemyDamageByPlayer){hits.sort((a,b)=>a.tick-b.tick);let total=0;state.enemyDamageByPlayer.set(pid,hits.map(hit=>({tick:hit.tick,total:(total+=Number(hit.damage))})));}
assert.equal(vm.runInContext('playerADR(0,state.tick)',context),0);
const kill=d.kills.find(k=>k.killer===0);state.tick=kill.tick;
assert.equal(vm.runInContext('playerADR(0,state.tick)',context),100);
state.tick=d.rounds[1].start;
assert.equal(vm.runInContext('playerADR(0,state.tick)',context),50);
console.log('PASS ADR includes cumulative enemy damage / rounds played');
state.tick=d.rounds[2].start;
state.timelineScope='round';vm.runInContext('resetTimeline()',context);
assert.equal(state.timelineStart,d.rounds[2].start);
assert.equal(state.timelineEnd,d.rounds[2].stop);
state.tick=d.rounds[3].start;vm.runInContext('resetTimeline()',context);
assert.equal(state.timelineStart,d.rounds[3].start);
state.timelineScope='match';vm.runInContext('resetTimeline()',context);
assert.equal(state.timelineStart,d.start);
assert.equal(state.timelineEnd,d.end);
console.log('PASS timeline round scope / full scope');
const smoke=d.utility.find(u=>u.type==='smoke');state.trajectoryEffects.set(smoke.trajectory_id,smoke);
state.tick=smoke.start-1;strokes=0;
vm.runInContext('paintTrajectories(state.tick,state.demo)',context);
assert(strokes>0);
state.tick=smoke.start;strokes=0;
vm.runInContext('paintTrajectories(state.tick,state.demo)',context);
assert.equal(strokes,0,'flight trail must disappear as grenade blooms');
console.log('PASS grenade flight disappears on effect activation');
