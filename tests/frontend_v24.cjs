'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'static/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'static/index.html'),'utf8');
assert(html.includes('id="ctTeamName" class="scoreboard-team-name">COUNTER-TERRORISTS'));
assert(html.includes('id="tTeamName" class="scoreboard-team-name">TERRORISTS'));
assert(html.includes('app.js?v=27') && html.includes('styles.css?v=27'));
const teamBegin=src.indexOf('function updateScoreboardTeamNames(');
const teamEnd=src.indexOf('function currentRoundAt(',teamBegin);
assert(teamBegin>=0 && teamEnd>teamBegin);
const labels={ctTeamName:{textContent:'',title:''},tTeamName:{textContent:'',title:''}};
const state={tick:10,demo:{rounds:[{team_names:{}},{team_names:{'3':'Team A','2':'Team B'}}]}};
const context=vm.createContext({state,$:id=>labels[id],currentRoundAt:t=>t<100?0:1});
vm.runInContext(src.slice(teamBegin,teamEnd),context);
vm.runInContext('updateScoreboardTeamNames(10)',context);
assert.deepEqual([labels.ctTeamName.textContent,labels.tTeamName.textContent],['COUNTER-TERRORISTS','TERRORISTS']);
vm.runInContext('updateScoreboardTeamNames(120)',context);
assert.deepEqual([labels.ctTeamName.textContent,labels.tTeamName.textContent],['Team A','Team B']);

// Exercise the genuine killfeed rendering routine using a tiny DOM mock.
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.className='';this.textContent='';}
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(){this.children=[]}
  setAttribute(k,v){this[k]=v}
}
const feed=new Element('div');
const document={
  createElement:tag=>new Element(tag),
  createTextNode:text=>({textContent:text,tagName:'#text'}),
};
const feedState={tick:100,demo:{tick_rate:64,kills:[
  {tick:90,round:0,killer:1,assister:2,victim:3,weapon:'ak47',flash_assist:true},
  {tick:96,round:0,killer:1,assister:2,victim:3,weapon:'ak47',flash_assist:false},
]},lastLiveFeedSignature:''};
const feedCtx=vm.createContext({
  document,state:feedState,$:id=>id==='liveKillfeed'?feed:null,KILLFEED_SECONDS:7,
  currentRoundAt:()=>0,playerVisible:()=>true,playerName:id=>`Player${id}`,
  killerTeam:()=>2,
  recentKillfeedEvents:(ks,t,ri,w,visible)=>ks.filter(k=>k.round===ri&&k.tick<=t&&k.tick>=t-w),
  killModifier:(flag,label)=>{const n=new Element('span');n.className='killfeed-special '+flag;n.textContent='FLASH';return n},
  weaponIcon:weapon=>{const n=new Element('span');n.textContent=weapon;return n},
});
const renderStart=src.indexOf('function refreshLiveKillfeed(){');
const renderEnd=src.indexOf('function refreshActiveUtility(){',renderStart);
vm.runInContext(src.slice(renderStart,renderEnd),feedCtx);
vm.runInContext('refreshLiveKillfeed()',feedCtx);
assert.equal(feed.children.length,2);
const [flashKill,normalKill]=feed.children;
const flashAssist=flashKill.children[1];
assert.equal(flashAssist.className,'killfeed-assister');
assert.equal(flashAssist.children.length,3,'flash must be within the assister span');
assert.equal(flashAssist.children[0].textContent,'+');
assert.equal(flashAssist.children[1].textContent,'FLASH','FLASH badge comes before assister name');
assert.equal(flashAssist.children[2].textContent,'Player2');
assert.equal(flashKill.children[2].textContent,'ak47','weapon follows the assister');
assert.equal(normalKill.children[1].children.length,2,'ordinary assists have no flash badge');
console.log('PASS v24: full fallback team names, real team names, and flash badge before assister');
