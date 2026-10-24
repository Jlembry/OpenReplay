const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){const start=src.indexOf('function '+name+'(');assert(start>=0,name);let a=src.indexOf('{',start),depth=0;for(let i=a;i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);}throw Error(name);}
const state={demo:{tick_rate:64,rounds:[{start:100,stop:3000,end:2500,freeze:140,round_seconds:115,winner:'CT'}],
 kills:[{round:0,tick:750,victim:2}],
 bomb_timer_seconds:40,bomb_events:[{round:0,tick:150,type:'pickup',player:1},{round:0,tick:200,type:'dropped',pos:[5,6,0]},
 {round:0,tick:300,type:'pickup',player:0},{round:0,tick:400,type:'planted',pos:[40,41,0]},
 {round:0,tick:600,type:'defuse_start',player:2,has_kit:false},{round:0,tick:900,type:'defuse_start',player:3,has_kit:true}],
 frames:[[100,[[0,0,0,0,2,0,100],[1,10,10,0,2,0,100],[2,20,20,0,3,0,100],[3,30,30,0,3,0,100]]]],
 sample_stride:8},frameTicks:[100],loadoutHistory:new Map(),tick:100};
const context=vm.createContext({state,Math,clamp:(v,a,b)=>Math.min(b,Math.max(a,v))});
for(const name of ['currentRoundAt','loadoutAt','bombCarrierAt','bombStateAt'])vm.runInContext(extract(name),context);
function bomb(t){return vm.runInContext(`bombStateAt(${t})`,context)}
assert.equal(bomb(160).player,1);assert.equal(bomb(225).status,'dropped');
assert.equal(bomb(301).player,0);assert.equal(bomb(450).status,'planted');
assert(bomb(650).defuse&&bomb(650).defuse.player===2);
assert.equal(bomb(750).defuse,null,'kill at exact tick must cancel defuse');
assert.equal(bomb(900).defuse.hasKit,true,'new kit defuser may start again');
assert.equal(bomb(900+64).defuse.remaining,4);
console.log('PASS bomb handoffs, planted timer, death interrupts defuse, kit retry');
// Half time: same underlying team swaps side; score must not reset.
const score={frames:[[100,[[0,0,0,0,3],[1,0,0,0,2]]],[1100,[[0,0,0,0,2],[1,0,0,0,3]]]],
 rounds:[{start:100,stop:999,end:800,winner:'CT'},{start:1100,stop:2000,end:1800,winner:'T'}]};
context.score=score;
vm.runInContext(extract('buildRoundScores'),context);
vm.runInContext('buildRoundScores(score)',context);
assert.equal(score.rounds[0].scoreAfter[0],1);
assert.equal(score.rounds[1].sideA,2);
assert.equal(score.rounds[1].scoreAfter[0],2);
assert.equal(score.finalScore[0],2);
console.log('PASS team scores follow player identities through side switch');
assert(src.includes('player-kill-badge')&&src.includes('round-win-symbol')&&src.includes("setTextIfChanged($('roundClock'),label)"));
console.log('PASS kill badges, round ending icons, timeline round clock');
