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
const ctx=vm.createContext({});
vm.runInContext(extract('kdPerspective'),ctx);
const kill={killer:1,victim:4,assister:8};
for(const [players,expected] of [
  [[], 'both'], [[1], 'kill'], [[4], 'death'], [[8], 'assist'], [[1,4], 'both'], [[4,8], 'death'], [[1,8], 'kill']
]) assert.equal(vm.runInContext('kdPerspective(k, tracked)',vm.createContext({kdPerspective:ctx.kdPerspective,k:kill,tracked:new Set(players)})),expected);
console.log('PASS green kill, red death, amber assist, split when both sides tracked');
