const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){
 const start=src.indexOf('function '+name+'(');assert(start>=0,name);
 let a=src.indexOf('{',start),depth=0;
 for(let i=a;i<src.length;i++){
   if(src[i]==='{')depth++;
   if(src[i]==='}' && --depth===0)return src.slice(start,i+1);
 }
 throw Error(name);
}
const state={demo:{tick_rate:64,rounds:[{start:100,stop:3000}],
 bomb_timer_seconds:40,bomb_events:[
 {round:0,tick:150,type:'pickup',player:1},
 {round:0,tick:190,type:'dropped',pos:[75,40,0]},
 {round:0,tick:210,type:'pickup',player:0},
 {round:0,tick:300,type:'planted',pos:[100,110,0]},
 {round:0,tick:364,type:'defuse_start',has_kit:false,player:2},
 {round:0,tick:428,type:'defuse_abort',player:2},
 {round:0,tick:492,type:'defuse_start',has_kit:true,player:3},
 {round:0,tick:812,type:'cleared'}]},
 frameTicks:[100,108],loadoutHistory:new Map(),tick:100};
state.demo.frames=[
 [100,[[1,0,0,0,2,0,100]]],
 [108,[[1,64,0,0,2,0,100]]]
];
state.demo.sample_stride=8;
const context=vm.createContext({state,Math,clamp:(v,a,b)=>Math.min(b,Math.max(a,v))});
for(const name of ['currentRoundAt','loadoutAt','bombCarrierAt','bombStateAt','tickFrameAt'])vm.runInContext(extract(name),context);
function bomb(t){return vm.runInContext(`bombStateAt(${t})`,context)}
assert.equal(bomb(160).status,'carried');assert.equal(bomb(160).player,1);
assert.equal(bomb(200).status,'dropped');assert.equal(bomb(200).pos[0],75);
assert.equal(bomb(230).status,'carried');assert.equal(bomb(230).player,0);
assert.equal(bomb(300).status,'planted');assert.equal(bomb(364).bombRemaining,39);
assert.equal(bomb(428).defuse,null,'aborted defuse must disappear');
assert.equal(bomb(364).defuse.hasKit,false);
assert.equal(bomb(364+32).defuse.remaining,9.5);
assert.equal(bomb(492).defuse.hasKit,true);assert.equal(bomb(492+64).defuse.remaining,4);
assert.equal(bomb(812).status,'unknown');
console.log('PASS bomb carrier/drop/plant transitions and real defuse events');
const moved=vm.runInContext('tickFrameAt(104)',context);
assert.equal(moved[0][1],32,'smooth C4 carrier position must be interpolated');
console.log('PASS normal player interpolation is used for carried C4');
assert(src.includes("paintC4Glyph(x,y,sideColor)"),'carrier must replace player dot');
assert(src.includes('for(const p of rows.filter(isDead))'),'dead layer missing');
assert(src.indexOf('for(const p of rows.filter(isDead))')<src.indexOf('for(const p of rows.filter(p=>!isDead(p)))'));
console.log('PASS dead player markers are rendered before living players');
assert(!src.includes('/static/icons/'),'legacy v11 icon requests still present');
assert(src.includes("ICON_FALLBACKS[flag]||label"),'modifier text fallback missing');
console.log('PASS no icon asset dependencies; modifiers remain text');
