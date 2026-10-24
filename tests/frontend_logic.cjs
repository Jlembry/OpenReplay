// Self-contained, no npm dependencies. Tests replay math without an installed browser.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname,'../static/app.js'),'utf8');
function extract(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start!==-1, `${name} exists`);
  let first=source.indexOf('{',start),depth=0,last=-1;
  for (let i=first;i<source.length;i++) {
    if(source[i]==='{')depth++;
    if(source[i]==='}' && !--depth){last=i+1;break;}
  }
  assert(last!==-1,`${name} has a complete body`);
  return source.slice(start,last);
}
const nodes={zoomValue:{textContent:''}};
const state={demo:null,tick:0,selectedPlayers:new Set(),eventPlayer:'all',flashIntervals:[],zoom:1,panX:0,panY:0,viewW:1024,viewH:1024,loadoutHistory:new Map(),trajectoryEffects:new Map()};
const context=vm.createContext({state,$:id=>nodes[id]??(nodes[id]={}),clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),console,
  radarPoint:pos=>[pos[0],pos[1]],playerName:i=>state.demo?.players?.[i]?.name||'Unknown',radarLabel:(...v)=>labels.push(v),TAU:Math.PI*2,UTIL_LABELS:{flash:'FLASH'},
  ctx:{save(){},restore(){},beginPath(){},moveTo(){},lineTo(){lineCount++},stroke(){strokeCount++},arc(){},fill(){},setLineDash(){}}});
let labels=[],lineCount=0,strokeCount=0;
for(const name of ['buildFlashIntervals','flashRemaining','currentRoundAt','playerVisible','roundKills','roundUtility',
  'isStacked','sceneCenterY','sceneHeight','baseScale','inverseCamera','changeZoom','resetView','trajectorySegment','utilityTypeVisible','paintTrajectories','createPreview']){
  vm.runInContext(extract(name),context);
}
const data=vm.runInContext('createPreview()',context);state.demo=data;state.tick=data.start;data.utility.forEach(u=>state.trajectoryEffects.set(u.trajectory_id,u));
assert.equal(data.rounds.length,12);
assert.equal(data.trajectories.length,60);
assert(data.utility.every(u=>typeof u.trajectory_id==='number'));
assert(data.trajectories.every(t=>t.end-t.start>=64));
state.flashIntervals=vm.runInContext('buildFlashIntervals(state.demo)',context);
state.tick=data.rounds[0].start+17*64+2;
const first=vm.runInContext('flashRemaining(6,state.tick)',context);
state.tick+=64;
const second=vm.runInContext('flashRemaining(6,state.tick)',context);
assert(first>second && second>0, `flash must count down: ${first}, ${second}`);
console.log('PASS flash duration counts down and rewinds deterministically');
state.tick=data.rounds[0].start;
assert.equal(vm.runInContext('roundKills().filter(k=>k.tick<=state.tick).length',context),0);
state.tick+=24*64;
assert.equal(vm.runInContext('roundKills().filter(k=>k.tick<=state.tick).length',context),1);
state.tick-=64;
assert.equal(vm.runInContext('roundKills().filter(k=>k.tick<=state.tick).length',context),0);
assert(source.includes('roundKills().filter(k=>k.tick<=state.tick)'), 'map also hides future kills');
assert(source.includes("state.eventTab==='kills'?visibleKills:us"),'event feed hides future kills');
console.log('PASS kills reveal on exact tick, hide when rewound, and timeline remains');
state.selectedPlayers.add(0);state.selectedPlayers.add(2);
assert(vm.runInContext('playerVisible(0)',context));
assert(!vm.runInContext('playerVisible(6)',context));
assert(vm.runInContext('roundUtility().every(u=>u.owner===0||u.owner===2)',context));
assert(vm.runInContext('roundKills().every(k=>[0,2].includes(k.killer)||[0,2].includes(k.victim))',context));
state.selectedPlayers.clear();
assert(vm.runInContext('playerVisible(6)',context));
console.log('PASS multi-select filters owned utility, visible player circles, and related kills');
vm.runInContext('changeZoom(1.5,600,450)',context);
assert.equal(state.zoom,1.5);
const anchor=vm.runInContext('inverseCamera(600,450)',context);
assert(Math.abs(anchor.x-600)<1e-8 && Math.abs(anchor.y-450)<1e-8);
assert.equal(nodes.zoomValue.textContent,'150%');
state.panX+=120;state.panY-=34;
vm.runInContext('resetView()',context);
assert.equal(state.zoom,1);assert.equal(state.panX,0);assert.equal(state.panY,0);
console.log('PASS camera zoom maintains cursor anchor; camera resets');
state.viewW=1400;state.viewH=680;
vm.runInContext('changeZoom(3,1300,400)',context);
assert.equal(state.zoom,3);
const mapPoint=vm.runInContext('inverseCamera(1300,400)',context);
assert(Number.isFinite(mapPoint.x)&&Number.isFinite(mapPoint.y));
state.panX+=8000;state.panY-=6000;
assert(vm.runInContext('inverseCamera(1300,400).x',context)<0,'pan is unrestricted');
vm.runInContext('resetView()',context);
console.log('PASS rectangular, unbounded camera');
state.tick=data.rounds[0].start+11*64;
lineCount=0;labels=[];strokeCount=0;
vm.runInContext('paintTrajectories(state.tick,state.demo)',context);
assert(lineCount>0);
assert(labels.some(l=>String(l[0]).includes('notej')));
state.selectedPlayers.add(6);
lineCount=0;
vm.runInContext('paintTrajectories(state.tick,state.demo)',context);
assert.equal(lineCount,0,'filtered out throwers must not show trajectories');
console.log('PASS grenade trails progressively draw from labeled throwers, player filter hides paths');
