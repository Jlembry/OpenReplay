const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){
  const start=src.indexOf('function '+name+'(');assert(start>=0,'missing '+name);
  let i=src.indexOf('{',start),depth=0;
  for(;i<src.length;i++){
    if(src[i]==='{')depth++;
    if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);
  }
  throw Error('unclosed '+name);
}
const context=vm.createContext({});
vm.runInContext(extract('recentKillfeedEvents'),context);
const events=[
 {tick:200,round:0,killer:0,victim:1,id:'late'},
 {tick:101,round:0,killer:2,victim:3,id:'early'},
 {tick:150,round:0,killer:0,victim:3,id:'middleA'},
 {tick:150,round:0,killer:1,victim:2,id:'middleB'},
 {tick:250,round:1,killer:2,victim:0,id:'wrongRound'}
];
context.events=events;
let actual=vm.runInContext('recentKillfeedEvents(events,200,0,150,()=>true).map(k=>k.id).join(",")',context);
assert.equal(actual,'early,middleA,middleB,late','killfeed must be oldest first regardless of source order');
actual=vm.runInContext('recentKillfeedEvents(events,155,0,150,()=>true).map(k=>k.id).join(",")',context);
assert.equal(actual,'early,middleA,middleB','seeking backward removes future kills');
actual=vm.runInContext('recentKillfeedEvents(events,200,0,70,()=>true).map(k=>k.id).join(",")',context);
assert.equal(actual,'middleA,middleB,late','expired kills are hidden');
actual=vm.runInContext('recentKillfeedEvents(events,200,0,150,p=>p===0).map(k=>k.id).join(",")',context);
assert.equal(actual,'middleA,late','killfeed respects selected-player filtering');
context.more=Array.from({length:9},(_,i)=>({id:'kill'+i,tick:105+i,round:0,killer:0,victim:1})).reverse();
actual=vm.runInContext('recentKillfeedEvents(more,125,0,150,()=>true).map(k=>k.id).join(",")',context);
assert.equal(actual,'kill3,kill4,kill5,kill6,kill7,kill8','only latest six shown, sorted oldest first');
assert(src.includes("event.shiftKey?'select':event.ctrlKey?'draw':'pan'"),'Shift must select, Ctrl must draw');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
assert(html.includes('<kbd>SHIFT</kbd> + DRAG · SELECT PLAYERS'));
assert(html.includes('<kbd>CTRL</kbd> + DRAG · DRAW WHITE'));
assert(html.includes('Shift + drag to select players'));
console.log('PASS v15 shortcuts, tick ordering, equal-tick stability, rewinding, expiry, filtering and newest-six window');
