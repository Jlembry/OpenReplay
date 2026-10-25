import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const context={self:{}};
vm.runInNewContext(readFileSync(new URL('../public/replay-adapter.js',import.meta.url),'utf8'),context);
const {parse,buildRounds,trimTail}=context.self.OpenReplayAdapter;
test('round ordering and stopping',()=>{
 const r=buildRounds([{tick:100},{tick:1000}], [{tick:800,winner:3,reason:8},{tick:1700,winner:2,reason:1}],[],[{tick:140}]);
 assert.equal(r.length,2);assert.equal(r[0].winner,'CT');assert.equal(r[0].win_type,'elimination');assert.equal(r[1].win_type,'explosion');
});
test('stationary tail removal',()=>{
 const p=[[10,0,0,0],[20,5,5,0],[40,5,5,0],[60,5,5,0],[90,5,5,0]];
 assert.equal(trimTail(p).length,2);
});
test('browser adapter returns OpenReplay schema from mock WASM',()=>{
 const rounds={round_start:[{tick:100}],round_end:[{tick:330,winner:3,reason:8}]};
 const mock={parseHeader:()=>({map_name:'de_mirage'}),
 parseEvent:(_b,name)=>rounds[name]||[],
 parseTicks:()=>[{tick:100,steamid:'76561110000000001',name:'Alpha',X:11,Y:22,Z:2,team_num:3,health:100},{tick:100,steamid:'76561110000000002',name:'Bravo',X:40,Y:52,Z:2,team_num:2,health:100},{tick:200,steamid:'76561110000000001',name:'Alpha',X:12,Y:22,Z:2,team_num:3,health:90}],
 parseGrenades:()=>[]};
 const got=parse(new Uint8Array([1]),'match.dem',mock,()=>{});
 assert.equal(got.players.length,2);assert.equal(got.frames.length,2);assert.equal(got.rounds.length,1);assert.equal(got.map,'de_mirage');
});
