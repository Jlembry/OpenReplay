'use strict';
const assert=require('assert'), fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'static/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'static/styles.css'),'utf8');
const html=fs.readFileSync(path.join(root,'static/index.html'),'utf8');
assert(html.includes('app.js?v=27') && html.includes('styles.css?v=27'));
assert(css.includes('.killfeed-special,.killfeed-special.headshot,.killfeed-special.flash_assist'));

class El{
  constructor(tag='span'){this.tagName=tag;this.className='';this.textContent='';this.children=[];}
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(){this.children=[]}
  setAttribute(k,v){this[k]=v}
}
const feed=new El('div');
const document={createElement:tag=>new El(tag),createTextNode:t=>({tagName:'#text',textContent:t})};
const kills=[
 {tick:100,round:0,killer:0,victim:1,assister:2,weapon:'awp',flash_assist:true,
  attackerblind:true,jumping:true,noscope:true,headshot:true},
 {tick:101,round:0,killer:1,victim:0,weapon:'ak47',
  attackerblind:false,jumping:false,noscope:false},
 {tick:102,round:0,killer:2,victim:0,weapon:'ssg08',noscope:true},
 {tick:103,round:0,killer:2,victim:1,weapon:'m4a1',jumping:true},
];
const state={tick:104,demo:{tick_rate:64,kills},lastLiveFeedSignature:''};
const ctx=vm.createContext({
  document,state,$:key=>key==='liveKillfeed'?feed:null,
  KILLFEED_SECONDS:7,currentRoundAt:()=>0,playerVisible:()=>true,
  playerName:id=>'Player'+id,killerTeam:()=>2,
  recentKillfeedEvents:(items,t,ri,w)=>items.filter(k=>k.tick<=t&&k.tick>=t-w&&k.round===ri),
  killModifier:(flag,label)=>{const el=new El();el.className='killfeed-special '+flag;el.textContent=flag.toUpperCase();el.title=label;return el;},
  weaponIcon:weapon=>{const el=new El();el.className='killfeed-weapon';el.textContent=weapon;return el;},
});
const start=src.indexOf('function refreshLiveKillfeed(){');
const end=src.indexOf('function refreshActiveUtility(){',start);
assert(start!==-1&&end>start);
vm.runInContext(src.slice(start,end),ctx);
vm.runInContext('refreshLiveKillfeed()',ctx);
assert.equal(feed.children.length,4);
const codes=row=>row.children.map(el=>el.className?.startsWith('killfeed-special')?el.className.split(' ').slice(-1)[0]:
 el.className?.includes('killfeed-assister')?'assister':el.className?.startsWith('killfeed-player')?el.textContent:
 el.className?.includes('killfeed-weapon')?'gun:'+el.textContent:'other');
assert.deepEqual(codes(feed.children[0]),['attackerblind','jumping','Player0','assister','gun:awp','noscope','headshot','Player1']);
assert.deepEqual(codes(feed.children[1]),['Player1','gun:ak47','Player0']);
assert.deepEqual(codes(feed.children[2]),['Player2','gun:ssg08','noscope','Player0']);
assert.deepEqual(codes(feed.children[3]),['jumping','Player2','gun:m4a1','Player1']);
const assist=feed.children[0].children.find(c=>c.className==='killfeed-assister');
assert.equal(assist.children[1].className,'killfeed-special flash_assist');
assert.equal(assist.children[2].textContent,'Player2');
// Badges do not duplicate between the pre-killer and weapon modifier areas.
assert.equal(codes(feed.children[0]).filter(s=>s==='attackerblind').length,1);
assert.equal(codes(feed.children[0]).filter(s=>s==='jumping').length,1);
// Rerender stays correct when the killfeed is rewound.
state.tick=101;
vm.runInContext('refreshLiveKillfeed()',ctx);
assert.equal(feed.children.length,2);
assert.deepEqual(codes(feed.children[0]).slice(0,3),['attackerblind','jumping','Player0']);
console.log('PASS v25: BLIND/AIR before killer, NS next to weapon, awarded FLASH before assister, no phantom flags, rewind');
