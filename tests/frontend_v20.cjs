const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const source = fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const styles = fs.readFileSync(path.join(__dirname,'../static/styles.css'),'utf8');

// Verify the actual killfeed component uses canonical names, including raw CS2 IDs.
const iconsBegin = source.indexOf('function weaponIcon(');
const iconsEnd = source.indexOf('function killModifier(');
const namesBegin = source.indexOf('const PRIMARY_WEAPONS=');
const namesEnd = source.indexOf('function renderEquipment(holder,gear)');
assert(iconsBegin>=0 && iconsEnd>iconsBegin && namesBegin>=0 && namesEnd>namesBegin);
const fakeDocument = {createElement(tag){return {tagName:tag,children:[],append(child){this.children.push(child)}}}};
const ctx=vm.createContext({document:fakeDocument});
vm.runInContext(source.slice(namesBegin,namesEnd)+'\n'+source.slice(iconsBegin,iconsEnd),ctx);
const label = weapon=>vm.runInContext('weaponIcon('+JSON.stringify(weapon)+').children[0].textContent',ctx);
const cases={
  elite:'Dual Berettas',weapon_elite:'Dual Berettas',dualberettas:'Dual Berettas',
  m4a1:'M4A4',m4a1_silencer:'M4A1-S',m4a1_silencer_off:'M4A1-S',
  usp_silencer:'USP-S',usp_silencer_off:'USP-S',hkp2000:'P2000',
  sg556:'SG 553',galilar:'Galil AR',bizon:'PP-Bizon',deagle:'Desert Eagle',
  glock:'Glock-18',glock18:'Glock-18',cz75a:'CZ75 Auto',revolver:'R8 Revolver',
  weapon_knife_karambit:'Karambit',weapon_knife_m9_bayonet:'M9 Bayonet',
  mp5sd:'MP5-SD',weapon_mac10:'MAC-10',weapon_hegrenade:'HE Grenade',
  weapon_incgrenade:'Incendiary Grenade',weapon_taser:'Zeus x27'
};
for (const [key,expected] of Object.entries(cases)) assert.strictEqual(label(key),expected,`${key} should display ${expected}`);
assert.strictEqual(label(null),'Unknown weapon');

// Assert makeRounds creates *only* one round label and one ending icon.
const roundsBegin=source.indexOf('function makeRounds(){');
const roundsEnd=source.indexOf('// The timeline is its own viewport',roundsBegin);
assert(roundsBegin>=0 && roundsEnd>roundsBegin);
class Node {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.textContent='';this.listeners={};}
  append(...items){this.children.push(...items)}
  appendChild(item){if(item.tagName==='fragment')this.children.push(...item.children);else this.children.push(item)}
  replaceChildren(){this.children=[]}
  addEventListener(name,handler){this.listeners[name]=handler}
  setAttribute(name,value){this[name]=value}
}
const elements={roundList:new Node('div'),viewerRound:new Node('select')};
const roundCtx=vm.createContext({
  state:{demo:{rounds:[{number:1,win_type:'elimination',winner:'CT',start:10},{number:2,win_type:'defuse',winner:'T',start:20}]}},
  $:name=>elements[name],document:{createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('fragment')},seek:()=>{}
});
vm.runInContext(source.slice(roundsBegin,roundsEnd),roundCtx);
vm.runInContext('makeRounds()',roundCtx);
assert.equal(elements.roundList.children.length,2);
for(const [index,row] of elements.roundList.children.entries()){
  assert.equal(row.children.length,2,'round must only have caption + win indicator');
  assert.equal(row.children[0].textContent,`Round ${String(index+1).padStart(2,'0')}`);
  assert.equal(row.children[1].className.includes('round-win-symbol'),true);
}
assert(/\.round-item\{grid-template-columns:minmax\(0,1fr\) 19px/.test(styles));
assert(/\.scoreboard-person>\.player-avatar\s*\{[^}]*flex:0 0 9px;[^}]*width:9px!important;height:9px!important/s.test(styles));
console.log('PASS v20: canonical killfeed names, single round label, circular scoreboard markers');
