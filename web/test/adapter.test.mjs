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

test('rounds fall back to recorded round_end if round_start decoding throws',()=>{
 const mock={parseHeader:()=>({map_name:'de_dust2'}),
   parseEvent:(_f,name)=>{
     if(name==='round_start')throw Error('unsupported event in this WASM build');
     if(name==='round_end')return [{tick:6900,winner:3,reason:8}];
     return [];
   },
   parseTicks:()=>[{tick:500,steamid:'1',name:'Alpha',X:10,Y:20,team_num:3,health:100},
     {tick:500,steamid:'2',name:'Bravo',X:20,Y:30,team_num:2,health:100}],parseGrenades:()=>[]};
 const out=parse(new Uint8Array([1]),'demo.dem',mock,()=>{});
 assert.equal(out.rounds.length,1);
 assert.equal(out.rounds[0].end,6900);
});

test('round_freeze_end can be used to recover approximate round boundaries',()=>{
 const mock={parseHeader:()=>({map_name:'de_nuke'}),
   parseEvent:(_f,name)=>name==='round_freeze_end'?[{tick:400},{tick:1000}]:[],
   parseTicks:()=>[{tick:400,steamid:'1',name:'Alpha',X:10,Y:20,team_num:3,health:100},
     {tick:400,steamid:'2',name:'Bravo',X:20,Y:30,team_num:2,health:100},
     {tick:1000,steamid:'1',name:'Alpha',X:20,Y:30,team_num:3,health:100}],parseGrenades:()=>[]};
 const out=parse(new Uint8Array([1]),'demo.dem',mock,()=>{});
 assert.equal(out.rounds.length,2);
 assert.equal(out.rounds[0].start,400);
 assert.equal(out.rounds[1].start,1000);
});

test('accepts event-name wrappers and alternate tick fields',()=>{
 const mock={parseHeader:()=>({map_name:'de_inferno'}),
   parseEvent:(_f,name)=>name==='round_start'?{round_start:[{game_tick:'100'}]}:
     name==='round_end'?{round_end:[{gameTick:300,winner:3,reason:8}]}:[],
   parseTicks:()=>[{tick:100,steamid:'1',name:'Alpha',X:11,Y:22,team_num:3,health:100}],
   parseGrenades:()=>[]};
 const got=parse(new Uint8Array([1]),'demo.dem',mock,()=>{});
 assert.equal(got.rounds.length,1);
 assert.equal(got.rounds[0].start,100);
 assert.equal(got.rounds[0].end,300);
});

test('reports precise missing round events rather than generic unsupported demo',()=>{
 const mock={parseHeader:()=>({map_name:'de_mirage'}),
   parseEvent:()=>{throw Error('Unsupported source2 event encoding');},
   listGameEvents:()=>['player_death','round_start'],parseTicks:()=>[],parseGrenades:()=>[]};
 assert.throws(()=>parse(new Uint8Array([1]),'demo.dem',mock,()=>{}),err=>{
   assert.match(err.message,/round_start=0, round_end=0/);
   assert.match(err.message,/Unsupported source2 event encoding/);
   assert.match(err.message,/Available round events: round_start/);
   return true;
 });
});

test('filters explicitly marked warmup rounds',()=>{
 const rounds=buildRounds([{tick:100,is_warmup_period:true},{tick:1000,is_warmup_period:false}],
   [{tick:800,is_warmup_period:true},{tick:1900,winner:3,reason:8}],[],[]);
 assert.equal(rounds.length,1);
 assert.equal(rounds[0].start,1000);
});


test('serde-wasm-bindgen Map results decode as header, events and tick rows',()=>{
 const row=(fields)=>new Map(Object.entries(fields));
 const mock={
   parseHeader:()=>new Map([['map_name','de_anubis']]),
   parseEvent:(_f,name)=>new Map([[name,name==='round_start'?[row({tick:100})]:name==='round_end'?[row({tick:400,winner:3,reason:8})]:[]]]),
   parseTicks:()=>[row({tick:100,steamid:'76561110000000001',name:'Alpha',X:12,Y:25,Z:0,team_num:3,health:100}),
                  row({tick:100,steamid:'76561110000000002',name:'Bravo',X:16,Y:30,Z:0,team_num:2,health:100})],
   parseGrenades:()=>[]
 };
 const got=parse(new Uint8Array([1]),'game.dem',mock,()=>{});
 assert.equal(got.map,'de_anubis');
 assert.equal(got.rounds.length,1);
 assert.equal(got.players.length,2);
 assert.equal(got.rounds[0].end,400);
});

test('numeric columns in Map form are decoded into rows',()=>{
 const mock={parseHeader:()=>new Map([['map_name','de_anubis']]),
   parseEvent:(_f,name)=>new Map([[name,name==='round_start'?[{tick:100}]:name==='round_end'?[{tick:400,winner:3,reason:8}]:[]]]),
   parseTicks:()=>new Map([
      ['tick',new Int32Array([100,100])],['X',new Float32Array([12,16])],['Y',new Float32Array([25,30])],
      ['steamid',['1','2']],['name',['Alpha','Bravo']],['team_num',[3,2]],['health',[100,100]]]),
   parseGrenades:()=>[]};
 const got=parse(new Uint8Array([1]),'game.dem',mock,()=>{});
 assert.equal(got.frames[0][1].length,2);
});


test('bulk parseEvents round events avoid redundant full-file reads',()=>{
 const requests=[];
 const mock={parseHeader:()=>({map_name:'de_mirage'}),
   parseEvents:(_f,names)=>{
     requests.push('batch');
     assert.ok(names.includes('round_start'));
     return new Map([['round_start',[{tick:100}]],['round_end',[{tick:400,winner:3,reason:8}]]]);
   },
   parseEvent:(_f,name)=>{
     if(['round_start','round_end'].includes(name))throw Error('round event should come from batch');
     return [];
   },
   parseTicks:()=>[{tick:100,steamid:'1',name:'Alpha',X:11,Y:22,team_num:3,health:100}],parseGrenades:()=>[]};
 const got=parse(new Uint8Array([1]),'game.dem',mock,()=>{});
 assert.equal(got.rounds.length,1);assert.deepEqual(requests,['batch']);
});
