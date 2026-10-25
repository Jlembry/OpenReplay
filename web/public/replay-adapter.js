/* Browser adaptation of OpenReplay's Python replay schema.
 * Source 2 query results are version-dependent; optional fields downgrade safely.
 * IMPORTANT: This adapter still requires parity testing against parser.py before a production release.
 */
'use strict';
self.OpenReplayAdapter=(()=>{
const STRIDE=8, RATE=64;
// serde_wasm_bindgen often returns JavaScript Maps, including nested Maps for
// each game-event row. Normalize these before querying event fields.
const plain = (value, depth=0) => {
 if (depth>24 || value===null || typeof value!=='object') return value;
 if (Object.prototype.toString.call(value)==='[object Map]') {
   return Object.fromEntries(Array.from(value.entries(), ([key,part])=>[String(key),plain(part,depth+1)]));
 }
 if (Array.isArray(value)) return value.map(part=>plain(part,depth+1));
 // Typed arrays should remain typed; they can represent property columns.
 if (ArrayBuffer.isView(value)) return value;
 if (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null) {
   return Object.fromEntries(Object.entries(value).map(([key,part])=>[key,plain(part,depth+1)]));
 }
 return value;
};
const N=x=>{if(x===null||x===undefined||x==='')return null;const n=Number(x);return Number.isFinite(n)?n:null;};
const integer=(x,d=null)=>{const n=N(x);return n==null?d:Math.trunc(n);};
const txt=x=>x==null?'':String(x);
const yes=x=>x===true||x===1||x==='1'||txt(x).toLowerCase()==='true';
const array=(data,eventName='')=>{
 data=plain(data);
 if(typeof data==='string'){try{data=JSON.parse(data);}catch{return [];}}
 if(Array.isArray(data))return data;
 if(eventName && data && typeof data==='object' && data[eventName]!==undefined)return array(data[eventName]);
 if(data?.events && Array.isArray(data.events))return data.events;
 if(data?.rows&&Array.isArray(data.rows))return data.rows;
 if(data?.data&&Array.isArray(data.data))return data.data;
 if(data?.columns&&Array.isArray(data?.data)&&Array.isArray(data.data[0]))return data.data.map(row=>Object.fromEntries(data.columns.map((k,i)=>[k,row[i]])));
 // WASM can return struct-of-arrays: {tick:[...],X:[...],...}
 if(data&&typeof data==='object'){
   const keys=Object.keys(data).filter(key=>Array.isArray(data[key])||ArrayBuffer.isView(data[key]));
   const length=data[keys[0]]?.length||0;
   if(keys.length&&length)return Array.from({length},(_,i)=>Object.fromEntries(keys.map(key=>[key,data[key][i]])));
 }
 return [];
};
const normalizedRows=(value,name='')=>array(value,name).filter(r=>r&&typeof r==='object').map(r=>{
 const tick=integer(r.tick??r.game_tick??r.gameTick??r.tick_number??r.tickNumber);
 return tick===null?null:{...r,tick};
}).filter(Boolean).sort((a,b)=>a.tick-b.tick);
const safeRows=(func)=>{try{return normalizedRows(func());}catch{return [];}};
const sid=v=>{if(v===null||v===undefined||v==='')return null;return String(v);};
const position=(r,p='')=>{
 const x=N(r[p+'X']??r[p+'x']),y=N(r[p+'Y']??r[p+'y']);
 return x===null||y===null?null:[x,y,N(r[p+'Z']??r[p+'z'])??0];
};
const entity=r=>integer(r.entityid??r.entity_id??r.entindex??r.entity_index??r.grenade_entity_id);
const kindFromWeapon=w=>{
 const s=txt(w).toLowerCase().replaceAll('_','');
 if(s.includes('flash'))return 'flash';if(s.includes('smoke'))return 'smoke';
 if(s.includes('hegrenade'))return 'he';if(s.includes('molotov')||s.includes('incendiary')||s.includes('incgrenade')||s.includes('inferno'))return 'fire';
 if(s.includes('decoy'))return 'decoy';return null;
};
function buildRounds(starts,ends,matches,freeze){
 const isWarmup=r=>yes(r?.is_warmup_period??r?.is_warmup);
 starts=starts.filter(r=>!isWarmup(r));
 ends=ends.filter(r=>!isWarmup(r));
 freeze=freeze.filter(r=>!isWarmup(r));
 let startTicks=[...new Set(starts.map(r=>integer(r.tick)).filter(n=>n!=null))].sort((a,b)=>a-b);
 const minMatch=matches.length?Math.min(...matches.map(r=>r.tick)):null;
 // Some event streams place round_announce_match_start after the first round start.
 // Never discard ALL actual round starts on the basis of this optional event alone.
 if(minMatch!==null){const filtered=startTicks.filter(t=>t>=minMatch);if(filtered.length)startTicks=filtered;}
 if(!startTicks.length&&ends.length){startTicks=[Math.max(0,ends[0].tick-6400),...ends.slice(0,-1).map(r=>r.tick+1)];}
 const fr=freeze.map(r=>integer(r.tick)).filter(t=>t!=null);
 // Some parser builds expose round_freeze_end but not round_start/round_end.
 // This preserves the observed round boundaries, with estimated first/last periods.
 if(!startTicks.length&&fr.length)startTicks=[...new Set(fr)].sort((a,b)=>a-b);

 return startTicks.map((start,i)=>{
  const next=startTicks[i+1],event=ends.find(e=>e.tick>=start&&(next===undefined||e.tick<next));
  const end=event?.tick??(next?next-1:start+115*RATE);
  const freezeTick=fr.find(t=>t>=start&&t<=end)??start;
  const raw=txt(event?.winner).toUpperCase();const winner=['3','CT','COUNTERTERRORIST'].includes(raw)?'CT':['2','T','TERRORIST'].includes(raw)?'T':'';
  const reason=integer(event?.reason),message=txt(event?.message).toLowerCase();
  const win_type=reason===1||message.includes('target_bombed')?'explosion':reason===7||message.includes('bomb_defused')?'defuse':
    [8,9].includes(reason)&&!/time|saved|surrender/.test(message)?'elimination':'other';
  const limit=N(starts.find(r=>r.tick===start)?.timelimit);
  return {number:i+1,start,freeze:freezeTick,end,stop:next?next-1:end+5*RATE,winner,win_type,win_reason:reason,
          round_seconds:limit>=30&&limit<=300?limit:115};
 });
}
function riOf(rounds,tick){let lo=0,hi=rounds.length-1,ix=-1;while(lo<=hi){let mid=(lo+hi)>>1;if(rounds[mid].start<=tick){ix=mid;lo=mid+1;}else hi=mid-1;}return ix>=0&&tick<=rounds[ix].stop?ix:-1;}
const trimTail=points=>{
 if(points.length<4)return points;const last=points.at(-1);let i=points.length-1;
 while(i>0&&Math.hypot(points[i-1][1]-last[1],points[i-1][2]-last[2],points[i-1][3]-last[3])<=2.5)i--;
 return i&&points.length-i>=3&&last[0]-points[i][0]>=12?points.slice(0,i+1):points;
};
function parse(file,filename,wasm,progress){
 const header=plain(wasm.parseHeader(file))||{};
 const map=txt(header.map_name||'unknown').toLowerCase();
 const eventsByType=new Map(),eventFailures=new Map();
 // Fetch related round events together in modern WASM builds. This avoids
 // reparsing the complete (potentially hundreds-of-MB) demo for each event.
 // Fall back to individual calls for older bindings or unsupported bulk APIs.
 const roundNames=['round_start','round_end','round_freeze_end','round_officially_ended','round_announce_match_start','round_prestart'];
 if(typeof wasm.parseEvents==='function'){
   try{
     const batch=plain(wasm.parseEvents(file,roundNames,[],[]));
     for(const name of roundNames){
       const rows=normalizedRows(batch,name);
       if(rows.length)eventsByType.set(name+'false',rows);
     }
   }catch(error){
     eventFailures.set('parseEvents',[String(error?.message||error).slice(0,160)]);
   }
 }
 const event=(name,extra=false)=>{
   const key=name+String(extra);if(eventsByType.has(key))return eventsByType.get(key);
   let rows=[],failures=[];
   const attempts=extra?
     [()=>wasm.parseEvent(file,name,['X','Y','Z','flash_duration']),()=>wasm.parseEvent(file,name)]:
     [()=>wasm.parseEvent(file,name,[],['is_warmup_period','total_rounds_played']),()=>wasm.parseEvent(file,name)];
   for(const attempt of attempts){
     try{rows=normalizedRows(attempt(),name);if(rows.length)break;}
     catch(e){failures.push(String(e?.message||e||'unknown parsing error').slice(0,160));}
   }
   if(failures.length)eventFailures.set(name,failures);
   eventsByType.set(key,rows);return rows;
 };
 const starts=event('round_start'),roundEnds=event('round_end'),freeze=event('round_freeze_end');
 const official=event('round_officially_ended');
 const matchStarts=event('round_announce_match_start');
 const alternativeStarts=starts.length?starts:event('round_prestart');
 const alternativeEnds=roundEnds.length?roundEnds:official;
 const rounds=buildRounds(alternativeStarts,alternativeEnds,matchStarts,freeze);
 if(!rounds.length){
   let available=[];
   try{const listed=wasm.listGameEvents?.(file);available=Array.isArray(listed)?listed.map(x=>String(x)).filter(x=>/round|match|freeze/.test(x)).slice(0,12):[];}
   catch(e){eventFailures.set('listGameEvents',[String(e?.message||e).slice(0,120)]);}
   const counts=`round_start=${starts.length}, round_end=${roundEnds.length}, round_freeze_end=${freeze.length}, round_officially_ended=${official.length}`;
   const failures=[...eventFailures.entries()].filter(([key])=>/round|match|freeze/.test(key))
     .slice(0,4).map(([key,msg])=>`${key}: ${msg[0]}`).join('; ');
   // No demo content, player identities, or file bytes are included in this error.
   throw Error(`Browser parser could not identify match rounds (${counts}). ${failures?`Parser errors: ${failures}. `:''}${available.length?`Available round events: ${available.join(', ')}. `:''}The WASM decoder could not decode entity-backed events from this recording. Use a current WASM parser build and compare against the local version.`);
 }
 const first=rounds[0].start,last=rounds.at(-1).stop;
 progress('Reading sampled player positions…');
 const requested=Array.from({length:Math.ceil((last-first)/STRIDE)+1},(_,i)=>first+i*STRIDE).filter(t=>t<=last);
 if(requested.at(-1)!==last)requested.push(last);
 const sampleTicks=new Int32Array(requested);
 const basic=['X','Y','Z','team_num','player_color','health','is_alive'];
 const stats=['kills_total','assists_total','deaths_total','utility_damage_total','enemies_flashed_total','balance','flash_duration'];
 const optional=['yaw','active_weapon_name','inventory','armor','has_helmet','has_defuser'];
 // Match the Python extractor's downgrade strategy for unsupported fields.
 let tickRows=[];let usedProps=[];
 for(const props of [basic.concat(stats,optional),basic.concat(stats,['yaw','active_weapon_name']),basic.concat(stats),basic.concat(['balance','flash_duration']),basic,['X','Y','team_num']]){
   try{tickRows=array(wasm.parseTicks(file,props,sampleTicks));if(tickRows.length&&'X' in tickRows[0]&&'tick' in tickRows[0]){usedProps=props;break;}}
   catch{tickRows=[];}
 }
 if(!tickRows.length)throw Error('WASM parser returned no player positions. Recording may be incompatible.');
 tickRows.sort((a,b)=>Number(a.tick)-Number(b.tick));
 progress('Building replay frames and loadouts…');
 const players=[],playerMap=new Map(),frames=[],loadouts=[],lastLoadout=new Map(),xs=[],ys=[];
 let frameTick=null,frame=[];
 const getPlayer=(value,name)=>{
   const key=sid(value)||'bot:'+txt(name||'Unknown');
   if(!playerMap.has(key)){playerMap.set(key,players.length);players.push({id:key,name:txt(name||'Unknown').slice(0,75)});}
   const ix=playerMap.get(key);if(name&&name!=='Unknown')players[ix].name=txt(name).slice(0,75);
   return ix;
 };
 for(const r of tickRows){
   const tick=integer(r.tick),x=N(r.X),y=N(r.Y),side=integer(r.team_num);
   if(tick===null||x===null||y===null||Math.abs(x)>100000||Math.abs(y)>100000)continue;
   if(frameTick!==null&&frameTick!==tick){if(frame.length)frames.push([frameTick,frame]);frame=[];}
   frameTick=tick;
   const idx=getPlayer(r.steamid??r.player_steamid,txt(r.name||r.player_name||'Unknown'));
   if(side!==2&&side!==3)continue;
   const hp= r.is_alive===false?0:integer(r.health,100);
   let inv=r.inventory||[];
   if(typeof inv==='string'){try{inv=JSON.parse(inv);}catch{inv=inv.split(/[;,]/).map(x=>x.trim()).filter(Boolean);}}
   if(!Array.isArray(inv))inv=[];
   const armor=integer(r.armor),helmet=r.has_helmet==null?null:yes(r.has_helmet),defuser=r.has_defuser==null?null:yes(r.has_defuser);
   const equip={active:txt(r.active_weapon_name),weapons:inv,armor,helmet,defuser};
   if(JSON.stringify(lastLoadout.get(idx))!==JSON.stringify(equip)){
     loadouts.push({tick,player:idx,...equip});lastLoadout.set(idx,equip);
   }
   frame.push([idx,x,y,N(r.Z)??0,side,integer(r.player_color,-1),hp,
     ...stats.slice(0,-1).map(key=>integer(r[key])),N(r.flash_duration),N(r.yaw)]);
   if(x||y){xs.push(x);ys.push(y);}
 }
 if(frameTick!==null&&frame.length)frames.push([frameTick,frame]);
 if(!frames.length)throw Error('No playable CT/T positions found.');
 const bounds=values=>{values.sort((a,b)=>a-b);if(!values.length)return [-2000,2000];let lo=values[Math.floor(values.length*.005)],hi=values[Math.min(values.length-1,Math.floor(values.length*.995))];if(hi<=lo)hi=lo+1024;const mid=(lo+hi)/2,spread=(hi-lo)*.62+250;return [mid-spread,mid+spread];};
 const actor=(r,p)=>{
   const id=sid(r[p+'_steamid']);if(id&&playerMap.has(id))return playerMap.get(id);
   const name=txt(r[p+'_name']).toLowerCase();
   if(name){for(const [key,ix] of playerMap)if(key.startsWith('bot:')&&key.slice(4).toLowerCase()===name)return ix;}
   return null;
 };
 const actorPos=(pid,tick)=>{
   if(pid==null)return null;
   let low=0,high=frames.length-1,ix=0;while(low<=high){const mid=(low+high)>>1;if(frames[mid][0]<=tick){ix=mid;low=mid+1;}else high=mid-1;}
   const row=frames[ix][1].find(r=>r[0]===pid);return row?.slice(1,4)||null;
 };
 progress('Reading kills, shots and bomb events…');
 const kills=event('player_death',true).map(r=>{
   const tick=integer(r.tick),round=riOf(rounds,tick);if(round<0)return null;
   const killer=actor(r,'attacker'),victim=actor(r,'user')??actor(r,'victim'),assister=actor(r,'assister');
   return {tick,round,killer,victim,assister,flash_assist:assister!=null&&yes(r.assistedflash??r.assisted_flash),
     weapon:txt(r.weapon||'unknown'),headshot:yes(r.headshot),wallbang:integer(r.penetrated,0)>0||yes(r.wallbang),
     thrusmoke:yes(r.thrusmoke??r.throughsmoke),noscope:yes(r.noscope??r.no_scope),
     attackerblind:yes(r.attackerblind??r.attacker_blind),
     jumping:yes(r.attackerinair??r.attacker_in_air??r.attacker_is_airborne),
     suicide:killer!==null&&killer===victim,
     killer_pos:position(r,'attacker_'),victim_pos:position(r,'user_')||position(r,'victim_')};
 }).filter(Boolean);
 const shots=event('weapon_fire',true).map(r=>{
   const weapon=txt(r.weapon).toLowerCase();const tick=integer(r.tick),owner=actor(r,'user')??actor(r,'player');
   if(owner===null||riOf(rounds,tick)<0||/flash|smoke|grenade|molotov|incendiary|decoy|knife|c4|taser/.test(weapon))return null;
   return {tick,owner,round:riOf(rounds,tick),weapon,yaw:N(r.user_yaw),pos:position(r,'user_')||actorPos(owner,tick)};
 }).filter(Boolean);
 const bombType={bomb_pickup:'pickup',player_given_c4:'pickup',bomb_dropped:'dropped',bomb_planted:'planted',bomb_defused:'cleared',bomb_exploded:'cleared',bomb_begindefuse:'defuse_start',bomb_abortdefuse:'defuse_abort'};
 const bomb_events=[];
 for(const [name,type] of Object.entries(bombType))for(const r of event(name,true)){
   const tick=integer(r.tick),round=riOf(rounds,tick);if(round<0)continue;
   const owner=actor(r,'user')??actor(r,'player');const item={tick,round,type,
       player:['pickup','defuse_start','defuse_abort'].includes(type)?owner:null,
       pos:['dropped','planted'].includes(type)?position(r)||position(r,'bomb_')||position(r,'user_')||actorPos(owner,tick):null,
       source:'event'};
   if(type==='defuse_start')item.has_kit=r.haskit==null?null:yes(r.haskit);
   if(name==='bomb_defused'||name==='bomb_exploded'){item.outcome=name==='bomb_defused'?'defuse':'explosion';
     rounds[round].win_type=item.outcome;if(!rounds[round].winner)rounds[round].winner=item.outcome==='defuse'?'CT':'T';}
   bomb_events.push(item);
 }
 bomb_events.sort((a,b)=>a.tick-b.tick);
 const hurts=event('player_hurt',true);
 const blinds=event('player_blind',true).map(r=>({tick:integer(r.tick),player:actor(r,'user'),thrower:actor(r,'attacker'),
   enemy:null,entity:entity(r),duration:N(r.blind_duration??r.user_flash_duration)})).filter(r=>r.tick!=null);
 const rawTypes={flashbang_detonate:'flash',smokegrenade_detonate:'smoke',hegrenade_detonate:'he',
   molotov_detonate:'fire',incgrenade_detonate:'fire',inferno_startburn:'fire',decoy_started:'decoy',decoy_detonate:'decoy'};
 const durations={flash:.3,smoke:20,he:.6,fire:7,decoy:15},utility=[];
 progress('Matching utility, impacts and projectile trajectories…');
 for(const [name,type] of Object.entries(rawTypes))for(const r of event(name,true)){
   const tick=integer(r.tick),round=riOf(rounds,tick);if(round<0)continue;
   const pos=position(r)||position(r,'user_'),ent=entity(r);
   if(['fire','decoy'].includes(type)&&utility.some(u=>u.type===type&&Math.abs(u.start-tick)<=8&&(u.entity!=null&&u.entity===ent||pos&&u.pos&&Math.hypot(pos[0]-u.pos[0],pos[1]-u.pos[1])<50)))continue;
   utility.push({type,start:tick,end:tick+Math.round(durations[type]*RATE),estimated_end:true,round,owner:actor(r,'user')??actor(r,'attacker'),entity:ent,pos,
     victims:[],damage:[],blinded:[]});
 }
 utility.sort((a,b)=>a.start-b.start);
 const ends={smoke:'smokegrenade_expired',fire:'inferno_expire',decoy:'decoy_stopped'};
 for(const u of utility){
   if(!ends[u.type])continue;
   const matching=event(ends[u.type],true).filter(r=>r.tick>=u.start&&r.tick<=u.start+45*RATE&&
     (u.entity==null||entity(r)==null||u.entity===entity(r))).sort((a,b)=>a.tick-b.tick)[0];
   if(matching){u.end=integer(matching.tick);u.estimated_end=false;}
 }
 const trajectories=[];
 const grenades=safeRows(()=>wasm.parseGrenades(file));
 const byEntity=new Map();
 for(const r of grenades){const id=entity(r),tick=integer(r.tick),pos=position(r);
   if(id===null||tick===null||!pos||tick<first||tick>last)continue;
   if(!byEntity.has(id))byEntity.set(id,[]);byEntity.get(id).push({tick,pos,row:r});
 }
 for(const [id,obs] of byEntity){
   let seg=[];const segments=[];
   for(const item of obs){if(seg.length&&item.tick-seg.at(-1).tick>192){segments.push(seg);seg=[];}seg.push(item);}
   if(seg.length)segments.push(seg);
   for(const s of segments){if(s.length<2)continue;const type=kindFromWeapon(s.find(a=>a.row.grenade_type||a.row.weapon||a.row.type)?.row.grenade_type||s[0].row.weapon||s[0].row.type);
     if(!type)continue;
     const ownerSid=s.map(a=>sid(a.row.thrower_steamid??a.row.user_steamid)).find(a=>playerMap.has(a));
     const owner=ownerSid?playerMap.get(ownerSid):null;
     let points=trimTail(s.map(a=>[a.tick,...a.pos]));
     points=points.filter((p,i)=>i===0||p[0]>points[i-1][0]);
     if(points.length<2)continue;
     const stride=Math.max(1,Math.floor(points.length/170)),sample=points.filter((_,i)=>i%stride===0);
     if(sample.at(-1)!==points.at(-1))sample.push(points.at(-1));
     trajectories.push({type,start:sample[0][0],end:sample.at(-1)[0],owner,entity:id,points:sample,estimated:false});
   }
 }
 // Best-effort correspondence to actual grenade events; NEVER fabricate a detonation.
 for(const u of utility){
   let best=Infinity,bestIndex=null;
   trajectories.forEach((tr,i)=>{if(tr.type!==u.type||u.owner!=null&&tr.owner!=null&&u.owner!==tr.owner)return;
     const gap=Math.abs(tr.end-u.start);if(gap<best){best=gap;bestIndex=i;}});
   if(best<192&&bestIndex!==null){u.trajectory_id=bestIndex;if(!u.pos)u.pos=trajectories[bestIndex].points.at(-1).slice(1);}
 }
 const damage_events=[],enemy_damage_events=[];
 for(const r of hurts){
   const tick=integer(r.tick),victim=actor(r,'user'),attacker=actor(r,'attacker'),type=kindFromWeapon(r.weapon),damage=Math.max(0,integer(r.dmg_health??r.damage,0)),armor=Math.max(0,integer(r.dmg_armor,0));
   if(!damage&&!armor||riOf(rounds,tick)<0)continue;
   if(type){
     const entry={tick,attacker,victim,damage,armor_damage:armor,weapon:txt(r.weapon),pos:position(r,'user_'),type};damage_events.push(entry);
     const u=utility.filter(u=>u.type===type&&u.round===riOf(rounds,tick)&&(attacker===null||u.owner===null||u.owner===attacker)&&
       (type==='fire'?u.start-8<=tick&&tick<=u.end+8:Math.abs(u.start-tick)<64)).sort((a,b)=>Math.abs(a.start-tick)-Math.abs(b.start-tick))[0];
     if(u)u.damage.push({player:victim,damage,armor_damage:armor,tick,pos:entry.pos});
   }
   if(attacker!==null&&victim!==null&&attacker!==victim&&damage>0){
     const a=actorPos(attacker,tick),v=actorPos(victim,tick);
     // Only credit when side identity is known and opposing from a nearby sampled frame.
     const ix=frames.findLastIndex(f=>f[0]<=tick),recent=frames.slice(Math.max(0,ix-8),ix+1);
     const sideFor=pid=>{for(let i=recent.length-1;i>=0;i--){const p=recent[i][1].find(row=>row[0]===pid);if(p)return p[4];}return null;};
     const as=sideFor(attacker),vs=sideFor(victim);
     if(as&&vs&&as!==vs)enemy_damage_events.push({tick,attacker,victim,damage});
   }
 }
 for(const b of blinds){
   const matching=utility.filter(u=>u.type==='flash'&&Math.abs(u.start-b.tick)<=64&&
     (b.thrower===null||u.owner===null||u.owner===b.thrower)).sort((a,b)=>Math.abs(a.start-b.tick)-Math.abs(b.start-b.tick))[0];
   if(matching)matching.blinded.push({player:b.player,duration:b.duration,tick:b.tick});
 }
 for(const u of utility)u.victims=u.type==='flash'?u.blinded:u.damage;
 const result={version:2,filename,map,tick_rate:RATE,sample_stride:STRIDE,start:first,
   end:Math.min(rounds.at(-1).stop,frames.at(-1)[0]),rounds,players,bounds:{x:bounds(xs),y:bounds(ys)},frames,kills,shots,loadouts,
   bomb_events,bomb_timer_seconds:Math.max(1,Math.min(120,N(header.mp_c4timer??header.bomb_timer)??40)),utility,blinds,trajectories,
   damage_events,enemy_damage_events,utility_diagnostics:{total:utility.length,event_based:utility.length,projectile_inferred:0,
     without_position:utility.filter(u=>!u.pos).length,trajectory_count:trajectories.length,measured_trajectories:trajectories.length,estimated_trajectories:0},
   available_stats:stats.filter(prop=>usedProps.includes(prop)),limits:{sampling_ticks:STRIDE,area_estimates:true,
     utility_end_estimated_if_missing:true,yaw_available:usedProps.includes('yaw'),equipment_available:usedProps.includes('inventory'),
     shot_events:shots.length,adr_available:hurts.length>0}};
 return result;
}
return {parse,buildRounds,trimTail};
})();
