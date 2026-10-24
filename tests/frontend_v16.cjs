const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
function extract(name){const start=src.indexOf('function '+name+'(');assert(start>=0,name);let p=src.indexOf('{',start),d=0;for(let i=p;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&--d===0)return src.slice(start,i+1);}throw Error(name);}
const state={floorView:'stacked',lowerImage:{},map:{lower_z_max:-495,calibrated:true,pos_x:0,pos_y:1024,scale:1},image:{},demo:{bounds:{x:[0,1024],y:[0,1024]}},viewW:1366,viewH:768,selectedUtilityTypes:new Set(['he','flash'])};
const context=vm.createContext({state,Math});
vm.runInContext('const FLOOR_GAP=96, LOWER_ORIGIN=1120;',context);
for(const name of ['isStacked','sceneCenterY','sceneHeight','mapOriginY','floorOf','worldToRadar','utilityTypeVisible'])vm.runInContext(extract(name),context);
assert.equal(vm.runInContext('sceneHeight()',context),2144);
let upper=vm.runInContext('worldToRadar([0,400,500,120])',context);
let lower=vm.runInContext('worldToRadar([0,400,500,-600])',context);
assert.equal(lower[1]-upper[1],1120,'stacked map must place lower floor BELOW upper');
state.floorView='layered';lower=vm.runInContext('worldToRadar([0,400,500,-600])',context);
assert.equal(lower[1],upper[1],'layered map must align the two floors');
assert.equal(vm.runInContext("utilityTypeVisible('smoke')",context),false);
assert.equal(vm.runInContext("utilityTypeVisible('flash')",context),true);
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
assert(!html.includes('id="toggleLOS"')&&html.includes('id="utilityTypePicker"')&&html.includes('id="toggleLevel"'));
console.log('PASS stacked/layered map, utility categories and controls, no LOS toggle');
