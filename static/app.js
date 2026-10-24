'use strict';

const $ = id => document.getElementById(id);
// Anonymous same-origin session. Its anti-CSRF token is never stored or shared.
const secureSession = fetch('/api/session', {credentials:'same-origin'}).then(async r=>{
  if(!r.ok)throw new Error('Private session unavailable. Reload the page.');
  const session=await r.json();
  if(session.mode==='web'){
    const chip=document.querySelector('.local-chip');if(chip)chip.textContent='PRIVATE WEB REPLAY';
    const foot=document.querySelector('.right-footnote');if(foot)foot.textContent='No account required. Replays expire automatically.';
  }
  return session;
});
const TEAM = {2:'#f0ad5b', 3:'#66aaff'};
const TAU = Math.PI * 2;
const state = {
  demo:null, playing:false, tick:0, speed:1, lastAnimation:0,
  lastDomUpdate:0, showNames:true, showGrid:false, showUtility:true, showDeaths:true,
  eventTab:'kills', eventPlayer:'all', utilityPlayers:new Set(), selectedKill:-1, selectedUtility:-1, selectedPlayers:new Set(), lastKillSignature:'', lastLiveFeedSignature:'', flashIntervals:[],
  map:null, image:null, upperImage:null, lowerImage:null, lower:false, floorView:'stacked', layeredFloor:'upper', selectedUtilityTypes:new Set(['smoke','flash','he','fire','decoy']),
  frameTicks:[], playerHistories:[], trajectoryEffects:new Map(), currentRound:-1, mapGeneration:0, toastTimer:null, busy:false, zoom:1, panX:0, panY:0, dragPointer:null, rosterRows:new Map(), loadoutHistory:new Map(), timelinePlayers:new Set(), timelineStart:0, timelineEnd:1, timelineScope:'match', scoreSort:{key:null,direction:null}, playerRoundPresence:[], enemyDamageByPlayer:new Map(), overviewDrag:null, viewW:1024, viewH:1024, pixelRatio:1, roundKillTicks:new Map(), radarStrokes:[],
  // These are rebuilt once per demo. No cached data is written into replay JSON.
  killsByRound:null, utilityByRound:null, deathTicksByRound:null,
  statEventIndex:null, statEnemyFlagPresent:false, flashIntervalsByPlayer:null,
  lastFrameCache:null, lastRosterCache:null, lastBombCache:null, lastCarrierCache:null,
  loadoutViewCache:new Map(), backdrop:null, backdropWidth:0, backdropHeight:0,
  lastPaintTime:0,
};
const canvas = $('radar'), ctx = canvas.getContext('2d');
const mainSlider = $('timeSlider');

function notify(message, error=false, delay=4500){
  const el=$('toast'); el.textContent=message; el.classList.toggle('error',error);
  el.classList.add('visible'); clearTimeout(state.toastTimer);
  state.toastTimer=setTimeout(()=>el.classList.remove('visible'),delay);
}
function setTextIfChanged(el,text){
  const next=String(text);
  if(el.textContent!==next)el.textContent=next;
}
function mmss(seconds){
  const n=Math.max(0,Math.floor(seconds));
  return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
}
function normalMapName(name){return (name||'unknown').replace(/^(de_|cs_|ar_)/,'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());}
function clamp(num, min, max){return Math.min(max,Math.max(min,num));}
// Track the same five-player team through side swaps, instead of counting CT
// victories as a single team (which would be wrong after halftime).
function buildRoundScores(d){
  const origin=d.frames.find(f=>f[1].some(p=>p[4]===3)&&f[1].some(p=>p[4]===2))?.[1]||[];
  const anchor=new Set(origin.filter(p=>p[4]===3).map(p=>p[0]));
  let a=0,b=0,lastSide=3,frameIndex=0;
  // Frames and rounds are both tick-sorted. Walk forward once instead of
  // rescanning thousands of frames from the beginning for every round.
  for(const round of d.rounds){
    while(frameIndex<d.frames.length && d.frames[frameIndex][0]<round.start)frameIndex++;
    let j=frameIndex;
    while(j<d.frames.length && d.frames[j][0]<=round.stop && d.frames[j][1].length<2)j++;
    const frame=j<d.frames.length && d.frames[j][0]>=round.start && d.frames[j][0]<=round.stop ? d.frames[j] : undefined;
    const allies=frame?.[1].filter(p=>anchor.has(p[0]))||[];
    const ct=allies.filter(p=>p[4]===3).length,t=allies.filter(p=>p[4]===2).length;
    if(ct!==t && (ct||t))lastSide=ct>t?3:2;
    round.sideA=lastSide;round.scoreBefore=[a,b];
    if(round.winner==='CT' || round.winner==='T'){
      const winSide=round.winner==='CT'?3:2;
      if(winSide===lastSide)a++;else b++;
    }
    round.scoreAfter=[a,b];
  }
  d.finalScore=[a,b];
}
function updateScoreAndRoundClock(round,tick){
  if(!round || !state.demo)return;
  const complete=tick>=round.end, [a,b]=complete?round.scoreAfter:round.scoreBefore;
  const ct=round.sideA===3?a:b,ter=round.sideA===3?b:a;
  setTextIfChanged($('scoreCT'),ct);
  setTextIfChanged($('scoreT'),ter);
  const [fa,fb]=state.demo.finalScore||[0,0];
  const fct=round.sideA===3?fa:fb,ft=round.sideA===3?fb:fa;
  setTextIfChanged($('matchFinal'),`FINAL ${fct} : ${ft}`);
  let label='';
  if(tick<round.freeze){label=`FREEZE ${mmss((round.freeze-tick)/state.demo.tick_rate)}`;}
  else if(tick>=round.end){label='ROUND ENDED';}
  else{
    const bomb=bombStateAt(tick);
    if(bomb.status==='planted')label=`BOMB ${mmss(bomb.bombRemaining)}`;
    else label=`ROUND ${mmss(Math.max(0,(round.round_seconds||115)-(tick-round.freeze)/state.demo.tick_rate))} LEFT`;
  }
  setTextIfChanged($('roundClock'),label);
}
// Team labels are sampled by round: teams can swap CT/T sides at halftime.
// Without a recorded clan name, use the full standard side heading.
function updateScoreboardTeamNames(tick=state.tick){
  const round=state.demo?.rounds?.[currentRoundAt(tick)];
  const recorded=round?.team_names || {};
  const ct=recorded[3] || recorded['3'] || 'COUNTER-TERRORISTS';
  const t=recorded[2] || recorded['2'] || 'TERRORISTS';
  for(const [id,name] of [['ctTeamName',ct],['tTeamName',t]]){
    const el=$(id);
    if(el.textContent!==name)el.textContent=name;
    el.title=name;
  }
}
function currentRoundAt(tick){
  const rs=state.demo?.rounds||[];
  let lo=0, hi=rs.length-1, result=-1;
  while(lo<=hi){let mid=(lo+hi)>>1; if(rs[mid].start<=tick){result=mid;lo=mid+1;}else{hi=mid-1;}}
  return result;
}
function seek(tick){
  const d=state.demo;if(!d)return;
  state.tick=clamp(tick,d.start,d.end);
  state.lastPaintTime=0;
  updateUI(true);
}
function setPlayback(isPlaying){
  state.playing=!!isPlaying && !!state.demo;
  $('playPause').textContent=state.playing?'Ⅱ':'▶';
  $('playPause').setAttribute('aria-label',state.playing?'Pause':'Play');
  state.lastAnimation=performance.now();
}
function jumpRound(delta){
  if(!state.demo)return;
  const i=currentRoundAt(state.tick);
  const next=clamp(i+delta,0,state.demo.rounds.length-1);
  seek(state.demo.rounds[next].start);
}
function loadReplay(data, preview=false){
  if(!data || !Array.isArray(data.frames) || data.frames.length===0 || !Array.isArray(data.rounds)){
    throw new Error('Replay has no playable frames.');
  }
  buildRoundScores(data);
  setPlayback(false);state.demo=data;state.tick=data.start;
  hideUtilityBreakdown();state.selectedKill=-1;state.selectedUtility=-1;state.eventPlayer='all';state.utilityPlayers.clear();state.eventTab='kills';state.selectedPlayers.clear();state.timelinePlayers.clear();state.selectedUtilityTypes=new Set(['smoke','flash','he','fire','decoy']);$('utilityTypePicker').querySelectorAll('input').forEach(input=>input.checked=true);$('utilityTypeSummary').textContent='All';state.timelineScope='match';state.timelineStart=data.start;state.timelineEnd=data.end;state.scoreSort={key:null,direction:null};state.lastKillSignature='';state.lastLiveFeedSignature='';$('liveKillfeed').replaceChildren();resetView();
  $('eventPlayer').value='all';$('eventPlayer').hidden=false;$('eventPlayerLabel').hidden=false;$('utilityPlayerPicker').hidden=true;$('utilityPlayerOptions').replaceChildren();$('utilityPlayerSummary').textContent='All';$('utilityPlayerPicker').open=false;$('killTab').classList.add('chosen');$('utilTab').classList.remove('chosen');$('utilityTypePicker').hidden=true;
  state.frameTicks=data.frames.map(f=>f[0]);state.currentRound=-1;state.lastRoundHeading=-1;
  state.lastFrameCache=null;state.lastRosterCache=null;state.lastBombCache=null;
  state.lastCarrierCache=null;state.loadoutViewCache.clear();
  // Keep complete player histories so the scoreboard never drops players merely
  // because a recording's sampled tick omitted their entity.
  state.playerHistories=data.players.map(()=>[]);
  state.playerRoundPresence=data.players.map(()=>new Set());
  for(const frame of data.frames){
    const roundIndex=currentRoundAt(frame[0]);
    for(const player of frame[1]){
      if(state.playerHistories[player[0]])state.playerHistories[player[0]].push([frame[0],player]);
      if(roundIndex>=0 && state.playerRoundPresence[player[0]])state.playerRoundPresence[player[0]].add(roundIndex);
    }
  }
  state.enemyDamageByPlayer=new Map();
  for(const hit of data.enemy_damage_events||[]){
    if(hit.attacker==null || !Number.isFinite(Number(hit.damage)))continue;
    if(!state.enemyDamageByPlayer.has(hit.attacker))state.enemyDamageByPlayer.set(hit.attacker,[]);
    state.enemyDamageByPlayer.get(hit.attacker).push(hit);
  }
  for(const [pid,hits] of state.enemyDamageByPlayer){
    hits.sort((a,b)=>a.tick-b.tick);
    let total=0;
    state.enemyDamageByPlayer.set(pid,hits.map(hit=>({tick:hit.tick,total:(total+=Number(hit.damage))})));
  }
  state.loadoutHistory=new Map();
  for(const loadout of data.loadouts||[]){
    if(!state.loadoutHistory.has(loadout.player))state.loadoutHistory.set(loadout.player,[]);
    state.loadoutHistory.get(loadout.player).push(loadout);
  }
  state.rosterRows.clear();$('ctPlayers').replaceChildren();$('tPlayers').replaceChildren();
  state.radarStrokes=[];state.dragPointer=null;canvas.classList.remove('dragging','selecting','drawing');
  // Index each player's exact kill ticks per round for a fast, live round-only badge.
  state.roundKillTicks=new Map();
  for(const k of data.kills||[]){
    if(k.killer==null || k.killer===k.victim || !Number.isInteger(k.round))continue;
    const key=k.round+':'+k.killer;
    if(!state.roundKillTicks.has(key))state.roundKillTicks.set(key,[]);
    state.roundKillTicks.get(key).push(k.tick);
  }
  for(const ticks of state.roundKillTicks.values())ticks.sort((a,b)=>a-b);
  if(Array.isArray(data.shots))data.shots.sort((a,b)=>a.tick-b.tick);
  data.utility=(data.utility||[]).filter(u=>!u.inferred_from_trajectory);
  state.flashIntervals=buildFlashIntervals(data);
  state.flashIntervalsByPlayer=new Map();
  for(const interval of state.flashIntervals){
    if(!state.flashIntervalsByPlayer.has(interval.player))state.flashIntervalsByPlayer.set(interval.player,[]);
    state.flashIntervalsByPlayer.get(interval.player).push(interval);
  }
  normalizeFlashUtilityImpacts(data, state.flashIntervals);
  buildReplayIndexes(data);
  (data.trajectories||[]).forEach(tr=>{tr.flight_end=flightEndOf(tr);});
  state.trajectoryEffects=new Map();
  (data.utility||[]).forEach(u=>{if(Number.isInteger(u.trajectory_id))state.trajectoryEffects.set(u.trajectory_id,u);});
  (data.trajectories||[]).forEach((tr,i)=>{if(!state.trajectoryEffects.has(i)){const match=(data.utility||[]).find(u=>u.type===tr.type && u.owner===tr.owner && Math.abs(u.start-tr.end)<128);if(match)state.trajectoryEffects.set(i,match);}});
  const diag=data.utility_diagnostics;
  $('utilityAvailability').textContent=(data.utility||[]).length
    ? `${data.utility.length} recorded utility activations`+(diag?` · ${diag.measured_trajectories??0} sampled flights · ${diag.without_position} missing positions`:'')+' · select Utility to inspect impacts'
    : 'No utility events or projectile tracks were decoded from this recording.';
  $('previewTag').classList.toggle('hidden',!preview);
  $('activeUtility').dataset.signature='';
  $('fileName').textContent=data.filename;
  document.querySelector('.status-indicator').classList.add('loaded');
  $('emptyPrompt').hidden=true;
  $('mapTitle').textContent=normalMapName(data.map)+'  /  Match Replay';
  $('breadcrumbMap').textContent=data.map.toUpperCase();
  $('overlayMap').textContent=data.map.toUpperCase();
  $('roundCount').textContent=String(data.rounds.length).padStart(2,'0');
  $('subtitle').textContent=preview?'Explore the interface with fictional sample movements.':'Demo loaded. Review every round, position and rotation.';
  mainSlider.min=data.start;mainSlider.max=data.end;mainSlider.step=1;
  buildTimelinePlayerPicker();updateScoreSortHeader();updateTimelineScopeButtons();
  $('totalTime').textContent=mmss((data.end-data.start)/data.tick_rate);
  makeRounds();makeMarks();makeEventPlayerOptions();setRadar(data.map);updateUI(true);updatePlayerFilter();
  notify(preview?'Sample playback loaded — select a real .dem to load your match.':'Demo successfully parsed. Ready for replay.');
}
function makeRounds(){
  const holder=$('roundList');holder.replaceChildren();
  const frag=document.createDocumentFragment();
  state.demo.rounds.forEach((round,i)=>{
    const b=document.createElement('button');b.type='button';b.className='round-item';
    b.dataset.round=String(i);
    const caption=document.createElement('span');caption.className='round-caption';caption.textContent=`Round ${String(round.number).padStart(2,'0')}`;
    const type=round.win_type||'other';
    const label=type==='defuse'?'Bomb defused':type==='explosion'?'Bomb exploded':type==='elimination'?'Opponents eliminated':'Other / unknown ending';
    const symbol=document.createElement('span');symbol.className='round-win-symbol '+type+' '+(round.winner||'unknown');
    if(type==='defuse'){
      symbol.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><rect x="3" y="7" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 7V4h8v3M12 10v8M8 14h8" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
    }else if(type==='elimination'){
      // A proper skull glyph (not a colored side-dot) for elimination victories.
      symbol.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16"><path d="M12 2C6.8 2 3.5 5.8 3.5 10.4c0 3.2 1.5 5.5 4.1 6.8V21h8.8v-3.8c2.6-1.3 4.1-3.6 4.1-6.8C20.5 5.8 17.2 2 12 2Z" fill="currentColor"/><circle cx="8.5" cy="11" r="2.2" fill="#11171e"/><circle cx="15.5" cy="11" r="2.2" fill="#11171e"/><path d="M12 12.5l-1.7 3h3.4L12 12.5Z" fill="#11171e"/><path d="M10 18v2m4-2v2" stroke="#11171e" stroke-width="1.3"/></svg>';
    }else if(type==='explosion')symbol.textContent='✹';
    // Deliberately no dot / placeholder for unknown outcomes.
    symbol.title=(round.winner?round.winner+' win · ':'')+label;
    symbol.setAttribute('aria-label',symbol.title);
    b.title=symbol.title;
    b.append(caption,symbol);b.addEventListener('click',()=>seek(round.start));
    frag.appendChild(b);
  });
  holder.appendChild(frag);
  const selector=$('viewerRound');selector.replaceChildren();
  state.demo.rounds.forEach((round,i)=>{
    const o=document.createElement('option');o.value=String(i);
    o.textContent=`R${String(round.number).padStart(2,'0')} · ${round.winner||'—'}`;
    selector.append(o);
  });
}
// The timeline is its own viewport and filter; neither changes the map roster.
// A single K/D event can represent a kill, a death, or both from the tracked players' perspectives.
// Without a timeline filter every event involves both teams, so use a split-color marker.
function kdPerspective(k, tracked){
  if(!tracked || tracked.size===0)return 'both';
  const killer=tracked.has(k.killer),victim=tracked.has(k.victim);
  return killer&&victim?'both':killer?'kill':victim?'death':tracked.has(k.assister)?'assist':'both';
}
function timelineParticipant(pid){return state.timelinePlayers.size===0 || (pid!=null && state.timelinePlayers.has(pid));}
function timelineKill(k){return timelineParticipant(k.killer)||timelineParticipant(k.victim)||timelineParticipant(k.assister);}
function utilityTypeVisible(type){return !state.selectedUtilityTypes || state.selectedUtilityTypes.has(type);}
function timelineUtility(u){return timelineParticipant(u.owner)|| [...(u.damage||[]),...(u.blinded||[]),...(u.victims||[])].some(v=>timelineParticipant(v.player));}
function timelineWindowSize(){return Math.max(1,state.timelineEnd-state.timelineStart);}
function timelineBounds(){
  const d=state.demo;
  if(!d)return {start:0,end:1};
  if(state.timelineScope==='round'){
    const round=d.rounds[Math.max(0,currentRoundAt(state.tick))];
    if(round)return {start:round.start,end:Math.max(round.start+1,Math.min(round.stop,d.end))};
  }
  return {start:d.start,end:d.end};
}
function updateTimelineScopeButtons(){
  for(const [id,mode] of [['timelineFullMatch','match'],['timelineCurrentRound','round']]){
    const button=$(id);button.classList.toggle('selected',state.timelineScope===mode);
    button.setAttribute('aria-pressed',String(state.timelineScope===mode));
  }
}
function setTimelineScope(scope){
  if(!state.demo)return;
  state.timelineScope=scope;updateTimelineScopeButtons();resetTimeline();
}
function clampTimelineWindow(start,end){
  const d=state.demo;if(!d)return;
  const bounds=timelineBounds();
  const total=Math.max(1,bounds.end-bounds.start);
  const minSpan=Math.min(total,Math.max(32,Math.round(d.tick_rate*2)));
  const span=clamp(end-start,minSpan,total);
  state.timelineStart=clamp(start,bounds.start,bounds.end-span);
  state.timelineEnd=state.timelineStart+span;
}
function setTimelineWindow(start,end){
  clampTimelineWindow(start,end);
  renderTimeline();
}
function zoomTimeline(multiplier,anchor){
  if(!state.demo)return;
  const oldSpan=timelineWindowSize();
  const bounds=timelineBounds(),total=bounds.end-bounds.start;
  const newSpan=clamp(oldSpan*multiplier,Math.min(Math.max(32,state.demo.tick_rate*2),total),total);
  const f=clamp((anchor-state.timelineStart)/oldSpan,0,1);
  setTimelineWindow(anchor-newSpan*f,anchor+newSpan*(1-f));
}
function panTimeline(fraction){
  const amount=timelineWindowSize()*fraction;
  setTimelineWindow(state.timelineStart+amount,state.timelineEnd+amount);
}
function resetTimeline(){if(state.demo){const b=timelineBounds();setTimelineWindow(b.start,b.end);}}
function buildTimelinePlayerPicker(){
  const wrap=$('timelinePlayerOptions');wrap.replaceChildren();
  for(let i=0;i<state.demo.players.length;i++){
    const label=document.createElement('label');label.className='timeline-player-option';
    const box=document.createElement('input');box.type='checkbox';box.value=String(i);box.checked=false;
    const name=document.createElement('span');name.textContent=playerName(i);
    box.addEventListener('change',()=>{
      if(box.checked)state.timelinePlayers.add(i);else state.timelinePlayers.delete(i);
      updateTimelinePlayerFilter();
    });
    label.append(box,name);wrap.append(label);
  }
  updateTimelinePlayerFilter();
}
function updateTimelinePlayerFilter(){
  const count=state.timelinePlayers.size;
  $('timelinePlayerSummary').textContent=count?`${count} tracked`:'All players';
  $('clearTimelinePlayers').hidden=!count;
  // Only timeline UI changes: playerVisible / selectedPlayers are intentionally untouched.
  buildTimelineEvents();
}
function makeMarks(){renderTimeline();}
function renderTimeline(){
  const d=state.demo;if(!d)return;
  const from=state.timelineStart,to=state.timelineEnd,span=timelineWindowSize();
  mainSlider.min=String(Math.floor(from));mainSlider.max=String(Math.ceil(to));
  mainSlider.value=String(clamp(state.tick,from,to));
  const holder=$('roundMarks');holder.replaceChildren();
  let last=from;
  for(const r of d.rounds){
    const a=Math.max(from,r.start),b=Math.min(to,r.stop);
    if(b<=a)continue;
    if(a>last){const gap=document.createElement('span');gap.className='round-mark';gap.style.width=100*(a-last)/span+'%';holder.append(gap);}
    const el=document.createElement('span');el.className='round-mark '+(r.winner||'').toLowerCase();
    el.style.width=100*(b-a)/span+'%';el.title='Round '+r.number;holder.append(el);last=b;
  }
  const overview=$('timelineOverviewWindow'),full=Math.max(1,d.end-d.start);
  overview.style.left=100*(from-d.start)/full+'%';overview.style.width=100*span/full+'%';
  const bounds=timelineBounds(),scopedFull=Math.max(1,bounds.end-bounds.start);
  const hasZoom=span<scopedFull-1;
  $('timelineWindowLabel').hidden=!hasZoom;
  $('timelineWindowLabel').textContent=hasZoom?`${mmss((from-d.start)/d.tick_rate)}–${mmss((to-d.start)/d.tick_rate)}`:'';
  $('timelineZoomValue').textContent=Math.round(scopedFull/span)+'×';
  updateTimelineProgress();buildTimelineEvents();
}
function updateTimelineProgress(){
  const span=timelineWindowSize();
  const pos=clamp((state.tick-state.timelineStart)/span,0,1);
  $('progressLine').style.width=100*pos+'%';
  mainSlider.value=String(Math.round(clamp(state.tick,state.timelineStart,state.timelineEnd)));
  $('timelineOverviewPlayhead').style.left=100*(state.tick-state.demo.start)/Math.max(1,state.demo.end-state.demo.start)+'%';
  $('timelineOffscreen').textContent=state.tick<state.timelineStart?'◀ PLAYHEAD BEFORE VIEW':state.tick>state.timelineEnd?'PLAYHEAD AFTER VIEW ▶':'';
}
function buildTimelineEvents(){
  const d=state.demo,holder=$('timelineEvents');holder.replaceChildren();
  if(!d)return;
  const from=state.timelineStart,to=state.timelineEnd,span=timelineWindowSize();
  const addPin=(tick,kind,label,callback,role='')=>{
    if(tick<from||tick>to)return;
    const mark=document.createElement('button');mark.type='button';mark.className='timeline-pin '+kind+(role?' kd-'+role:'');
    mark.style.left=`${100*(tick-from)/span}%`;mark.dataset.tick=String(tick);
    mark.textContent=kind==='kd'?(role==='kill'?'K':role==='death'?'D':role==='assist'?'A':'K/D'):'U';
    mark.title=label+' · '+mmss((tick-d.start)/d.tick_rate);
    mark.setAttribute('aria-label',mark.title);
    mark.addEventListener('click',callback);holder.append(mark);
  };
  (d.kills||[]).forEach((k,index)=>{
    if(!timelineKill(k))return;
    const role=kdPerspective(k,state.timelinePlayers);
    const label=(role==='kill'?'KILL':role==='death'?'DEATH':role==='assist'?'ASSIST':'K/D')+' · '+`${playerName(k.killer)} killed ${playerName(k.victim)}`;
    addPin(k.tick,'kd',label,()=>{
      state.eventTab='kills';$('killTab').classList.add('chosen');$('utilTab').classList.remove('chosen');$('utilityTypePicker').hidden=true;
      state.selectedKill=index;state.selectedUtility=-1;seek(k.tick);refreshEvents();
    },role);
  });
  (d.utility||[]).forEach((u,index)=>{
    if(!timelineUtility(u)||!utilityTypeVisible(u.type))return;
    addPin(u.start,'utility',`${UTIL_LABELS[u.type]||u.type} · ${playerName(u.owner)}`,()=>{
      state.eventTab='utility';$('killTab').classList.remove('chosen');$('utilTab').classList.add('chosen');$('utilityTypePicker').hidden=false;
      state.selectedKill=-1;state.selectedUtility=index;seek(u.start);refreshEvents();
    });
  });
  for(const pin of holder.children)if(pin.classList.contains('kd'))pin.classList.toggle('upcoming',Number(pin.dataset.tick)>state.tick);
}
async function setRadar(name){
  state.mapGeneration++;
  const gen=state.mapGeneration;
  state.image=null;state.map=null;state.lower=false;state.floorView='stacked';state.layeredFloor='upper';state.upperImage=null;state.lowerImage=null;
  $('toggleLevel').style.display='none';$('layerFloorControls').hidden=true;updateFloorButtons();$('levelBadge').textContent='LEVEL 01';document.querySelector('#toggleLevel span').textContent='Stacked';$('toggleLevel').classList.remove('active');
  $('radarStatus').textContent='FETCHING RADAR';
  try{
    const r=await fetch('/api/maps/'+encodeURIComponent(name));
    if(!r.ok)throw new Error('Map service error');
    const meta=await r.json();if(gen!==state.mapGeneration)return;
    if(!meta.radar){$('radarStatus').textContent='WORLD COORDINATE GRID';notify('Radar unavailable. Accurate player positions are still shown on the coordinate grid.');return;}
    const img=await imageLoad(meta.image);
    if(gen!==state.mapGeneration)return;
    state.map=meta;state.upperImage=img;state.image=img;
    $('radarStatus').textContent='RADAR CALIBRATED';
    if(meta.has_lower){$('toggleLevel').style.display='inline-flex';imageLoad(meta.image_lower).then(lower=>{if(gen===state.mapGeneration){state.lowerImage=lower;$('levelBadge').textContent='UPPER / LOWER';updateFloorButtons();resetView();}}).catch(()=>{});}
  }catch(ex){if(gen===state.mapGeneration)$('radarStatus').textContent='WORLD COORDINATE GRID';}
}
function imageLoad(src){return new Promise((resolve,reject)=>{let image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Radar image not available'));image.src=src;});}
function tickFrameAt(tick){
  const d=state.demo;
  if(!d)return [];
  if(state.lastFrameCache?.tick===tick)return state.lastFrameCache.rows;
  const remember=rows=>(state.lastFrameCache={tick,rows},rows);
  const arr=state.frameTicks;
  let lo=0,hi=arr.length;
  while(lo<hi){let mid=(lo+hi)>>1;if(arr[mid]<=tick)lo=mid+1;else hi=mid;}
  const prev=d.frames[Math.max(0,lo-1)],next=d.frames[Math.min(arr.length-1,lo)];
  if(!prev)return [];
  const dt=next[0]-prev[0];
  if(!dt || dt>Math.max(25,3*d.sample_stride))return remember(prev[1]);
  const ratio=clamp((tick-prev[0])/dt,0,1);
  if(ratio<=0)return remember(prev[1]);
  const map=new Map(next[1].map(p=>[p[0],p]));
  return remember(prev[1].map(p=>{
    const b=map.get(p[0]);
    if(!b || b[4]!==p[4] || p[6]===0 || b[6]===0)return p;
    return [p[0],p[1]+(b[1]-p[1])*ratio,p[2]+(b[2]-p[2])*ratio,
      p[3]+(b[3]-p[3])*ratio,p[4],p[5],p[6],...p.slice(7)];
  }));
}
const FLOOR_GAP=96, LOWER_ORIGIN=1024+FLOOR_GAP;
function visibleRadarFloor(floor){return state.floorView!=='layered'||!state.lowerImage||state.layeredFloor===floor;}
function updateFloorButtons(){
  const controls=$('layerFloorControls');if(!controls)return;controls.hidden=!(state.lowerImage&&state.floorView==='layered');
  for(const floor of ['upper','lower']){const button=$('layerFloor'+floor[0].toUpperCase()+floor.slice(1));button.classList.toggle('active',state.layeredFloor===floor);button.setAttribute('aria-pressed',String(state.layeredFloor===floor));}
}
function isStacked(){return !!(state.lowerImage && state.floorView==='stacked');}
function floorOf(z){return state.map?.lower_z_max!=null && Number(z)<=Number(state.map.lower_z_max)?'lower':'upper';}
function mapOriginY(floor){return isStacked() && floor==='lower'?LOWER_ORIGIN:0;}
function sceneCenterY(){return isStacked()?(LOWER_ORIGIN+1024)/2:512;}
function sceneHeight(){return isStacked()?LOWER_ORIGIN+1024:1024;}
function worldToRadar(p){
  const meta=state.map;
  let x,y;
  if(meta?.calibrated&&state.image){
    x=(p[1]-meta.pos_x)/meta.scale;y=(meta.pos_y-p[2])/meta.scale;
  }else{
    const b=state.demo?.bounds||{x:[-2000,2000],y:[-2000,2000]};
    x=64+896*(p[1]-b.x[0])/(b.x[1]-b.x[0]);y=960-896*(p[2]-b.y[0])/(b.y[1]-b.y[0]);
  }
  return [x,y+mapOriginY(floorOf(p[3]))];
}
function updateUI(force=false){
  const d=state.demo;if(!d)return;
  const t=state.tick, fraction=(t-d.start)/(d.end-d.start);
  updateTimelineProgress();
  setTextIfChanged($('elapsedTime'),mmss((t-d.start)/d.tick_rate));
  setTextIfChanged($('liveTick'),'TICK '+String(Math.round(t)).padStart(6,'0'));
  const ri=currentRoundAt(t),round=d.rounds[ri];
  if(ri!==state.currentRound){
    state.currentRound=ri;state.selectedKill=-1;state.selectedUtility=-1;state.lastKillSignature='';hideUtilityBreakdown();
    $('viewerRound').value=String(ri);
    if(state.timelineScope==='round')resetTimeline();
    refreshEvents();
    document.querySelectorAll('.round-item').forEach((b,index)=>b.classList.toggle('active',index===ri));
    const roundList=$('roundList'),active=roundList.querySelector('.round-item.active');
    // Scroll only the sidebar list. scrollIntoView() also scrolled the page's
    // main workspace, unintentionally hiding the score and current-round HUD.
    if(active && document.activeElement!==active){
      const item=active.getBoundingClientRect(),area=roundList.getBoundingClientRect();
      if(item.top<area.top)roundList.scrollTop-=area.top-item.top+3;
      else if(item.bottom>area.bottom)roundList.scrollTop+=item.bottom-area.bottom+3;
    }
  }
  if(round){
    if(state.lastRoundHeading!==ri){
      $('heroRound').textContent='';
      const n=document.createTextNode(String(round.number).padStart(2,'0')+' ');
      const span=document.createElement('span');span.textContent='/ '+d.rounds.length;
      $('heroRound').append(n,span);
      state.lastRoundHeading=ri;
    }
    const phase=t<round.freeze?'FREEZE TIME':t>round.end?'POST ROUND':'LIVE ROUND';
    setTextIfChanged($('roundPhase'),`ROUND ${String(round.number).padStart(2,'0')} · ${phase}`);
    updateScoreAndRoundClock(round,t);
  }
  if(force || performance.now()-state.lastDomUpdate>100){
    refreshLiveKillfeed();
    document.querySelectorAll('.timeline-pin.kd').forEach(pin=>pin.classList.toggle('upcoming',Number(pin.dataset.tick)>t));
    refreshPlayers(rosterAt(t));refreshActiveUtility();
    const visibleSignature=ri+'|'+roundKills().filter(k=>k.tick<=t).map(k=>k.id).join(',');
    if(state.lastKillSignature!==visibleSignature){state.lastKillSignature=visibleSignature;if(state.eventTab==='kills')refreshEvents();}
    state.lastDomUpdate=performance.now();
  }
}
const UTILITY_BADGES={smoke:'◌',fire:'♨',flash:'✦',he:'✷',decoy:'◇'};
// CS2-inspired right-hand kill feed; game event flags are shown only when
// actually present. No fabricated jumping/penetration/no-scope indicators.
const KILLFEED_SECONDS=7;
function killerTeam(pid,tick){
  if(pid==null)return null;
  const p=rosterAt(tick).find(row=>row[0]===pid);
  return p?.[4]??null;
}
// Keep the killfeed deliberately asset-free: accurate weapon labels and
// consistent orange modifier pills, including awarded flash assists.
const ICON_FALLBACKS={headshot:'HS',wallbang:'WB',thrusmoke:'SMOKE',
  noscope:'NS',attackerblind:'BLIND',jumping:'AIR',flash_assist:'FLASH',
  dominated:'DOM',revenge:'REV'};
function weaponIcon(weapon){
  // Demo kill events expose internal IDs (for example 'elite', 'm4a1',
  // 'usp_silencer'). Use the same canonical lookup as the inventory instead
  // of exposing those IDs as weapon names in the killfeed.
  const key=itemKey(weapon);
  const displayName=({flashbang:'Flashbang',incgrenade:'Incendiary Grenade',
    decoy:'Decoy Grenade'}[key]||weaponShort(weapon))||'Unknown weapon';
  const wrap=document.createElement('span');wrap.className='killfeed-weapon';
  wrap.title=displayName;
  const label=document.createElement('b');label.className='killfeed-weapon-text';
  label.textContent=displayName;
  wrap.append(label);return wrap;
}
function killModifier(flag,label){
  const el=document.createElement('span');el.className='killfeed-special '+flag;
  el.title=label;el.setAttribute('aria-label',label);
  el.textContent=ICON_FALLBACKS[flag]||label;
  return el;
}
// Feed order is governed by the exact kill tick, not the order in which the
// demo parser happened to return events. Earlier kills appear above later
// kills, even when multiple kills occur within one sampled position frame.
// Preserve the source event order as a stable tiebreaker for identical ticks.
function recentKillfeedEvents(kills, tick, roundIndex, windowTicks, isPlayerVisible, limit=6){
  return kills.map((kill, originalIndex)=>({kill,originalIndex}))
    .filter(({kill})=>kill.round===roundIndex && kill.tick<=tick &&
      kill.tick>=tick-windowTicks &&
      (isPlayerVisible(kill.killer)||isPlayerVisible(kill.victim)))
    .sort((a,b)=>a.kill.tick-b.kill.tick||a.originalIndex-b.originalIndex)
    .slice(-limit)
    .map(({kill})=>kill);
}
function refreshLiveKillfeed(){
  const box=$('liveKillfeed'),d=state.demo;
  if(!box||!d)return;
  const t=state.tick,ri=currentRoundAt(t),windowTicks=KILLFEED_SECONDS*d.tick_rate;
  const visible=recentKillfeedEvents(state.killsByRound?.get(ri)||(d.kills||[]),t,ri,windowTicks,playerVisible);
  const sig=visible.map(k=>[k.tick,k.killer,k.victim,k.assister,k.flash_assist,
    k.attackerblind,k.jumping,k.noscope,k.headshot,k.wallbang,k.thrusmoke].join(':')).join('|');
  if(sig===state.lastLiveFeedSignature)return;
  state.lastLiveFeedSignature=sig;box.replaceChildren();
  for(const k of visible){
    const row=document.createElement('div');row.className='killfeed-entry';
    const name=(pid,team)=>{
      const e=document.createElement('span');e.className='killfeed-player '+(team===3?'ct':team===2?'t':'neutral');
      e.textContent=pid==null?'WORLD':playerName(pid);return e;
    };
    const attacker=name(k.killer,killerTeam(k.killer,k.tick));
    const victim=name(k.victim,killerTeam(k.victim,k.tick));
    // CS2's attackerblind and attackerinair flags describe the KILLER,
    // so place these orange badges before the killer name, never by the gun.
    if(k.attackerblind)row.append(killModifier('attackerblind','Killer was blinded'));
    if(k.jumping)row.append(killModifier('jumping','Killer was airborne'));
    row.append(attacker);
    if(k.assister!=null && k.assister!==k.killer){
      const assist=document.createElement('span');assist.className='killfeed-assister';
      assist.append(document.createTextNode('+'));
      if(k.flash_assist)assist.append(killModifier('flash_assist','Awarded flash assist'));
      assist.append(name(k.assister,killerTeam(k.assister,k.tick)));
      row.append(assist);
    }
    row.append(weaponIcon(k.weapon));
    const specials=[['noscope','No-scope'],
      ['thrusmoke','Through smoke'],['wallbang','Wallbang'],
      ['headshot','Headshot'],['dominated','Domination'],['revenge','Revenge']];
    for(const [flag,label] of specials)if(k[flag])row.append(killModifier(flag,label));
    row.append(victim);
    row.title=`${playerName(k.killer)} ${k.weapon||'unknown'} ${playerName(k.victim)}`+
      (k.flash_assist?` · awarded flash assist: ${playerName(k.assister)}`:'');
    box.append(row);
  }
}

function refreshActiveUtility(){
  const holder=$('activeUtility');
  const d=state.demo;
  const active=d&&state.showUtility?(d.utility||[]).filter(u=>u.start<=state.tick && u.end>=state.tick && playerVisible(u.owner) && utilityTypeVisible(u.type)):[];
  const signature=active.map(u=>[u.type,u.end,((u.end-state.tick)/d.tick_rate).toFixed(1),u.estimated_end].join(':')).join('|')+'|'+active.length;
  if(holder.dataset.signature===signature)return;
  holder.dataset.signature=signature;
  holder.replaceChildren();
  if(!d||!state.showUtility)return;
  for(const util of active.slice(0,7)){
    const chip=document.createElement('div');chip.className='utility-chip util-'+util.type;
    const symbol=document.createElement('span');symbol.className='util-symbol';symbol.textContent=UTILITY_BADGES[util.type]||'◈';
    const name=document.createElement('span');name.textContent=UTIL_LABELS[util.type]||util.type;
    const time=document.createElement('strong');time.textContent=((util.end-state.tick)/d.tick_rate).toFixed(1)+'s'+(util.estimated_end?' ≈':'');
    chip.append(symbol,name,time);holder.append(chip);
  }
  if(active.length>7){const more=document.createElement('div');more.className='utility-chip';more.textContent=`+${active.length-7} more`;holder.append(more);}
}
function makeEventPlayerOptions(){
  const utilityOptions=$('utilityPlayerOptions');utilityOptions.replaceChildren();
  state.demo.players.forEach((p,i)=>{
    const label=document.createElement('label');label.className='utility-player-choice';
    const box=document.createElement('input');box.type='checkbox';box.value=String(i);box.checked=state.utilityPlayers.has(i);
    box.addEventListener('change',()=>{if(box.checked)state.utilityPlayers.add(i);else state.utilityPlayers.delete(i);refreshUtilityPlayers();});
    label.append(box,document.createTextNode(p.name));utilityOptions.append(label);
  });
  const sel=$('eventPlayer');sel.replaceChildren();
  const all=document.createElement('option');all.value='all';all.textContent='All players';sel.append(all);
  state.demo.players.forEach((p,i)=>{
    const o=document.createElement('option');o.value=String(i);o.textContent=p.name;sel.append(o);
  });
  sel.value='all';
}
function refreshUtilityPlayers(){
  const n=state.utilityPlayers.size;
  $('utilityPlayerSummary').textContent=n?`${n} selected`:'All';
  $('clearUtilityPlayers').hidden=!n;
  state.selectedUtility=-1;hideUtilityBreakdown();refreshEvents();
}
function utilityPlayerMatched(u){
  if(!state.utilityPlayers.size)return true;
  const involved=[u.owner,...[...(u.damage||[]),...(u.blinded||[]),...(u.victims||[])].map(v=>v.player)];
  return involved.some(p=>state.utilityPlayers.has(Number(p)));
}
function playerName(i){return i===null || i===undefined?'World':(state.demo?.players[i]?.name||'Unknown');}
function statFallback(pid,key,tick){
  const indexed=state.statEventIndex?.get(key);
  if(indexed)return cumulativeValue(indexed.get(pid),tick);
  // The fallback supports tests and embedded preview fixtures initialized
  // without calling loadReplay; normal uploaded demos always use the index.
  const d=state.demo;
  if(key==='kills_total')return (d.kills||[]).filter(e=>e.tick<=tick&&e.killer===pid&&e.victim!==pid).length;
  if(key==='deaths_total')return (d.kills||[]).filter(e=>e.tick<=tick&&e.victim===pid).length;
  if(key==='assists_total')return (d.kills||[]).filter(e=>e.tick<=tick&&e.assister===pid).length;
  if(key==='utility_damage_total')return (d.damage_events||[]).filter(e=>e.tick<=tick&&e.attacker===pid).reduce((s,e)=>s+e.damage,0);
  if(key==='enemies_flashed_total')return (d.blinds||[]).filter(e=>e.tick<=tick&&e.thrower===pid&&e.enemy===true).length;
  return null;
}
// Per-player cumulative counters and per-round event lookup avoid repeatedly
// scanning an entire match while the scoreboard or radar is updating.
function buildReplayIndexes(d){
  state.killsByRound=new Map();state.utilityByRound=new Map();
  state.deathTicksByRound=new Map();
  const stats=new Map();
  for(const key of ['kills_total','assists_total','deaths_total','utility_damage_total','enemies_flashed_total'])stats.set(key,new Map());
  const add=(key,pid,tick,delta=1)=>{
    if(pid==null || !Number.isFinite(tick))return;
    const perPlayer=stats.get(key);
    if(!perPlayer.has(pid))perPlayer.set(pid,[]);
    perPlayer.get(pid).push([tick,delta]);
  };
  (d.kills||[]).forEach((k,id)=>{
    if(!state.killsByRound.has(k.round))state.killsByRound.set(k.round,[]);
    state.killsByRound.get(k.round).push({...k,id});
    if(k.killer!==k.victim)add('kills_total',k.killer,k.tick);
    add('assists_total',k.assister,k.tick);
    add('deaths_total',k.victim,k.tick);
    if(k.victim!=null){
      const key=k.round+':'+k.victim;
      if(!state.deathTicksByRound.has(key))state.deathTicksByRound.set(key,[]);
      state.deathTicksByRound.get(key).push(k.tick);
    }
  });
  (d.utility||[]).forEach((u,id)=>{
    if(!state.utilityByRound.has(u.round))state.utilityByRound.set(u.round,[]);
    state.utilityByRound.get(u.round).push({...u,id});
  });
  for(const hit of d.damage_events||[])add('utility_damage_total',hit.attacker,hit.tick,hit.damage);
  for(const blind of d.blinds||[])if(blind.enemy===true)add('enemies_flashed_total',blind.thrower,blind.tick);
  for(const perPlayer of stats.values())for(const [pid,records] of perPlayer){
    records.sort((a,b)=>a[0]-b[0]);
    let total=0;
    perPlayer.set(pid,records.map(([tick,delta])=>[tick,(total+=delta)]));
  }
  for(const ticks of state.deathTicksByRound.values())ticks.sort((a,b)=>a-b);
  state.statEventIndex=stats;
  state.statEnemyFlagPresent=(d.blinds||[]).some(b=>b.enemy!==null&&b.enemy!==undefined);
}
function cumulativeValue(series,tick){
  if(!series?.length)return 0;
  let lo=0,hi=series.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(series[mid][0]<=tick)lo=mid+1;else hi=mid;}
  return lo?series[lo-1][1]:0;
}
function roundHasDeath(ri,pid,tick){
  const ticks=state.deathTicksByRound?.get(ri+':'+pid);
  if(state.deathTicksByRound)return !!ticks?.length && ticks[0]<=tick;
  return (state.demo?.kills||[]).some(k=>k.round===ri&&k.victim===pid&&k.tick<=tick);
}
function currentStat(p,index,key){
  const d=state.demo;
  if([7,8,9].includes(index) && d.kills?.length)return statFallback(p[0],key,state.tick);
  if(index===10 && d.damage_events?.length)return statFallback(p[0],key,state.tick);
  if(index===11 && d.blinds?.length && (state.statEventIndex?state.statEnemyFlagPresent:d.blinds.some(b=>b.enemy!==null && b.enemy!==undefined)))return statFallback(p[0],key,state.tick);
  if(p.length>index && p[index]!==null && p[index]!==undefined && Number.isFinite(Number(p[index])))return Number(p[index]);
  return statFallback(p[0],key,state.tick);
}
function rosterAt(tick){
  if(state.lastRosterCache?.tick===tick)return state.lastRosterCache.rows;
  const ri=currentRoundAt(tick);
  const round=state.demo?.rounds[ri];
  const results=[];
  for(const history of state.playerHistories){
    if(!history.length)continue;
    let lo=0,hi=history.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(history[mid][0]<=tick)lo=mid+1;else hi=mid;}
    // When someone isn't sampled at this tick, retain their latest full stat/side
    // snapshot. Before their first sample, use the first known snapshot.
    const record=history[Math.max(0,lo-1)];
    if(!record)continue;
    let p=record[1];
    if(round && record[0]<round.start){
      // For missing players around side swaps, use the round's first known snapshot.
      let j=lo;while(j<history.length && history[j][0]<round.start)j++;
      if(j<history.length && history[j][0]<=round.stop)p=history[j][1];
    }
    const row=p.slice();
    if(round && roundHasDeath(ri,row[0],tick))row[6]=0;
    results.push(row);
  }
  state.lastRosterCache={tick,rows:results};
  return results;
}
function loadoutAt(pid,tick){
  const history=state.loadoutHistory.get(pid)||[];
  let lo=0,hi=history.length;
  while(lo<hi){const m=(lo+hi)>>1;if(history[m].tick<=tick)lo=m+1;else hi=m;}
  return history[Math.max(0,lo-1)]||null;
}
// Exact requested loadout categories, in display order. Preserve the full recorded
// inventory rather than relying on which weapon the player has equipped.
const PRIMARY_WEAPONS=new Set('mag7 nova sawedoff xm1014 bizon mac10 mp7 mp5sd mp9 p90 ump45 ak47 aug famas galilar m4a4 m4a1s sg553 m249 negev awp g3sg1 scar20 ssg08'.split(' '));
const PISTOL_WEAPONS=new Set('deagle revolver elite fiveseven glock hkp2000 usps p250 cz75a tec9'.split(' '));
const UTILITY_WEAPONS=new Set('flashbang smokegrenade molotov incgrenade hegrenade decoy'.split(' '));
const ITEM_ALIASES={
  m4a1:'m4a4',m4a1silencer:'m4a1s',m4a1silenceroff:'m4a1s',
  uspsilencer:'usps',uspsilenceroff:'usps',usp:'usps',mp5navy:'mp5sd',
  galil:'galilar',sg556:'sg553',sg552:'sg553',bizon:'bizon',ump45:'ump45',mac10:'mac10',
  cz75:'cz75a',cz75auto:'cz75a',fiveseven:'fiveseven',tec9:'tec9',
  r8revolver:'revolver',deserteagle:'deagle',dualberettas:'elite',p2000:'hkp2000',
  glock18:'glock',highexplosive:'hegrenade',highexplosivegrenade:'hegrenade',
  heexplosive:'hegrenade',hegrenadeprojectile:'hegrenade',grenadehe:'hegrenade',
  incendiary:'incgrenade',incendiarygrenade:'incgrenade',incendiarygrenadeprojectile:'incgrenade',
  molotovcocktail:'molotov',flashgrenade:'flashbang',smoke:'smokegrenade',smokegrenadeprojectile:'smokegrenade',
  c4explosive:'c4',c4bomb:'c4',bomb:'c4',bombc4:'c4',plantedc4:'c4',
  knifet:'knife',knifegg:'knife',knifecss:'knifeclassic',taser:'zeus',zeusx27:'zeus',
  knifeclassic:'knifeclassic',knifetactical:'knifehuntsman',
  knifegypsyjackknife:'knifenavaja'
};
const ITEM_LABELS={
  mag7:'MAG-7',nova:'Nova',sawedoff:'Sawed-Off',xm1014:'XM1014',bizon:'PP-Bizon',mac10:'MAC-10',mp7:'MP7',mp5sd:'MP5-SD',mp9:'MP9',p90:'P90',ump45:'UMP-45',ak47:'AK-47',aug:'AUG',famas:'FAMAS',galilar:'Galil AR',m4a4:'M4A4',m4a1s:'M4A1-S',sg553:'SG 553',m249:'M249',negev:'Negev',awp:'AWP',g3sg1:'G3SG1',scar20:'SCAR-20',ssg08:'SSG 08',
  deagle:'Desert Eagle',revolver:'R8 Revolver',elite:'Dual Berettas',fiveseven:'Five-SeveN',glock:'Glock-18',hkp2000:'P2000',usps:'USP-S',p250:'P250',cz75a:'CZ75 Auto',tec9:'Tec-9',
  flashbang:'Flash',smokegrenade:'Smoke Grenade',molotov:'Molotov',incgrenade:'Incendiary',hegrenade:'HE Grenade',decoy:'Decoy',c4:'C4',
  zeus:'Zeus x27',inferno:'Fire',world:'World',knife:'Knife',bayonet:'Bayonet',
  knifeclassic:'Classic Knife',knifehuntsman:'Huntsman Knife',
  knifebutterfly:'Butterfly Knife',knifefalchion:'Falchion Knife',
  knifeflip:'Flip Knife',knifegut:'Gut Knife',knifekarambit:'Karambit',
  knifem9bayonet:'M9 Bayonet',knifebowie:'Bowie Knife',
  knifepush:'Shadow Daggers',knifecord:'Paracord Knife',
  knifecanis:'Survival Knife',knifeursus:'Ursus Knife',
  knifegypsyjackknife:'Navaja Knife',knifeoutdoor:'Nomad Knife',
  knifewidowmaker:'Talon Knife',knifestiletto:'Stiletto Knife',
  knifeskeleton:'Skeleton Knife',knifekukri:'Kukri Knife'
};
function itemKey(value){
  const original=String(value||'').toLowerCase().replace(/^weapon_/,'');
  const key=original.replace(/[^a-z0-9]/g,'');
  return ITEM_ALIASES[key]||key;
}
function inventoryClass(value){
  const key=itemKey(value);
  if(PRIMARY_WEAPONS.has(key))return 'primary';
  if(PISTOL_WEAPONS.has(key))return 'pistol';
  if(UTILITY_WEAPONS.has(key))return 'utility';
  if(key.includes('knife')||key.includes('bayonet')||key.includes('karambit'))return 'knife';
  if(key==='c4'||key==='bomb')return 'bomb';
  return 'other';
}
function weaponShort(value){
  const key=itemKey(value);
  if(ITEM_LABELS[key])return ITEM_LABELS[key];
  const raw=String(value||'').replace(/^weapon_/i,'').replace(/[_-]+/g,' ').trim();
  return raw.replace(/\b[a-z]/g,c=>c.toUpperCase());
}
function normalizedLoadout(pid){
  const loadout=loadoutAt(pid,state.tick);
  if(!loadout)return {groups:[],title:'Inventory not available in this demo',hasBomb:false,unknown:true};
  const carrier=bombCarrierAt(state.tick),cached=state.loadoutViewCache?.get(pid);
  if(cached && cached.loadout===loadout && cached.carrier===carrier)return cached.value;
  const inventory=Array.isArray(loadout.weapons)?loadout.weapons:null;
  const weapons=inventory?inventory.slice():loadout.active?[loadout.active]:[];
  const items=weapons.map(w=>({name:weaponShort(w),kind:inventoryClass(w)}));
  const bombKnown=carrier!==undefined;
  // C4 may be repeated under different inventory aliases. It belongs only in
  // the Bomb category and should appear at most once, independent of source.
  const shown=[];
  let bombListed=false;
  for(const item of items){
    if(item.kind==='bomb'){
      if((bombKnown&&carrier!==pid)||bombListed)continue;
      shown.push({name:'C4',kind:'bomb'});bombListed=true;
    }else shown.push(item);
  }
  if(carrier===pid&&!bombListed)shown.push({name:'C4',kind:'bomb'});
  const equipment=[];
  if(loadout.armor>0)equipment.push({name:loadout.helmet?'Kevlar + Helmet':'Kevlar',kind:'equipment'});
  else if(loadout.helmet)equipment.push({name:'Kevlar + Helmet',kind:'equipment'});
  if(loadout.defuser)equipment.push({name:'Defuse Kit',kind:'equipment'});
  const all=[...shown,...equipment];
  const order=['primary','pistol','knife','utility','equipment','bomb','other'];
  const ordered=order.flatMap(kind=>all.filter(x=>x.kind===kind));
  const title=inventory?ordered.map(x=>x.name).join(', ')||'No gear recorded':
    'Partial inventory (active weapon only)'+(ordered.length?': '+ordered.map(x=>x.name).join(', '):'');
  const value={groups:ordered,title,hasBomb:carrier===pid||(carrier===undefined&&items.some(x=>x.kind==='bomb')),unknown:!inventory};
  state.loadoutViewCache?.set(pid,{loadout,carrier,value});
  return value;
}
function renderEquipment(holder,gear){
  // Reuse the scoreboard row; only its loadout chips update as gear changes.
  const signature=JSON.stringify([gear.groups,gear.unknown]);
  if(holder.dataset.signature===signature)return;
  holder.dataset.signature=signature;holder.replaceChildren();
  if(!gear.groups.length){const missing=document.createElement('span');missing.className='loadout-empty';missing.textContent=gear.unknown?'Inventory unavailable':'No items';holder.append(missing);return;}
  for(const item of gear.groups){
    const badge=document.createElement('span');badge.className='gear-chip gear-'+item.kind;
    badge.textContent=item.name;badge.title=item.kind.toUpperCase()+' · '+item.name;holder.append(badge);
  }
  if(gear.unknown){const missing=document.createElement('span');missing.className='loadout-empty';missing.textContent='partial';holder.append(missing);}
}
function bombCarrierAt(tick){
  if(state.lastCarrierCache?.tick===tick)return state.lastCarrierCache.value;
  const remember=value=>(state.lastCarrierCache={tick,value},value);
  const d=state.demo,ri=currentRoundAt(tick),round=d?.rounds[ri];if(!round)return undefined;
  const events=(d.bomb_events||[]).filter(e=>e.round===ri&&e.tick<=tick);
  // Bomb ownership can be recorded as events or observed C4 inventory changes.
  // A recorded drop/plant always clears the holder until a subsequent pickup.
  let status='unknown',owner=null;
  for(const e of events){
    if(e.type==='pickup'){status='carried';owner=e.player;}
    else if(e.type==='dropped'){status='dropped';owner=null;}
    else if(e.type==='planted'){status='planted';owner=null;}
    else if(e.type==='cleared'){status='cleared';owner=null;}
  }
  if(status!=='unknown')return remember(status==='carried'?owner:null);
  // Last fallback when *no event* establishes ownership: live inventory.
  let candidate=null,latest=-Infinity;
  for(const [pid] of state.loadoutHistory){
    const snap=loadoutAt(pid,tick);
    if(!snap||snap.tick<round.start||snap.tick>tick||!Array.isArray(snap.weapons))continue;
    if(snap.weapons.some(w=>inventoryClass(w)==='bomb')&&snap.tick>=latest){candidate=pid;latest=snap.tick;}
  }
  return remember(candidate==null?undefined:candidate);
}
function bombStateAt(tick){
  if(state.lastBombCache?.tick===tick)return state.lastBombCache.value;
  const remember=value=>(state.lastBombCache={tick,value},value);
  const d=state.demo,ri=currentRoundAt(tick),round=d?.rounds[ri];
  if(!round)return {status:'unknown'};
  const events=(d.bomb_events||[]).filter(e=>e.round===ri&&e.tick<=tick);
  let info={status:'unknown'},planted=null,defuse=null;
  for(const e of events){
    if(e.type==='cleared'){
      info={status:'unknown'};planted=null;defuse=null;
    }else if(e.type==='pickup'){
      info=e.player==null?{status:'unknown'}:{status:'carried',player:e.player};planted=null;defuse=null;
    }else if(e.type==='dropped'){
      info={status:'dropped',pos:e.pos||null,positionSource:e.source||'event'};planted=null;defuse=null;
    }else if(e.type==='planted'){
      planted={tick:e.tick,pos:e.pos||null};
      info={status:'planted',pos:planted.pos,plantTick:e.tick};defuse=null;
    }else if(e.type==='defuse_start' && planted && e.player!=null){
      const snapshot=loadoutAt(e.player,e.tick),recorded=e.has_kit;
      const hasKit=recorded==null?Boolean(snapshot?.defuser):Boolean(recorded);
      defuse={tick:e.tick,player:e.player,hasKit};
    }else if(e.type==='defuse_abort' && defuse && (e.player==null||e.player===defuse.player)){
      defuse=null;
    }
  }
  if(info.status==='planted'){
    const bombSeconds=Number(d.bomb_timer_seconds)||40;
    const remaining=Math.max(0,bombSeconds-(tick-planted.tick)/d.tick_rate);
    if(defuse){
      // A death automatically interrupts defusing even if the recording did
      // not include bomb_abortdefuse. Exact kill ticks beat sampled HP.
      const killed=(d.kills||[]).some(k=>k.victim===defuse.player && k.tick>=defuse.tick && k.tick<=tick && k.round===ri);
      const sampled=typeof rosterAt==='function'?rosterAt(tick).find(p=>p[0]===defuse.player):null;
      if(killed || (sampled && sampled[6]<=0) || tick>=defuse.tick+(defuse.hasKit?5:10)*d.tick_rate || remaining<=0){
        defuse=null;
      }
    }
    return remember({...info,bombRemaining:remaining,
      defuse:defuse?{...defuse,remaining:Math.max(0,(defuse.hasKit?5:10)-(tick-defuse.tick)/d.tick_rate)}:null});
  }
  if(info.status!=='unknown')return remember(info);
  if(events.length)return remember(info);
  const carrier=bombCarrierAt(tick);
  return remember(carrier==null?info:{status:'carried',player:carrier});
}
function paintC4Glyph(x,y,sideColor='#e0bb70'){
  // Sized to the same footprint as the normal player dot.
  ctx.save();ctx.shadowColor='#071019';ctx.shadowBlur=5;
  ctx.beginPath();ctx.roundRect(x-13,y-10,26,20,5);
  ctx.fillStyle='#f0ce85';ctx.fill();ctx.shadowBlur=0;
  ctx.strokeStyle=sideColor;ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='#182633';ctx.font='900 12px system-ui,sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('C4',x,y+.5);
  ctx.restore();
}
function paintBomb(info){
  // Carried C4 is drawn INSTEAD of the live player dot, using that player's
  // interpolated tick position. Never draw a second C4 underneath them.
  if(!state.demo || !['dropped','planted'].includes(info.status))return;
  const point=info.pos?radarPoint(info.pos):null;
  if(!point)return;
  const [x,y]=point;
  if(info.status==='dropped'){paintC4Glyph(x,y);return;}
  ctx.save();ctx.shadowColor='#080d13';ctx.shadowBlur=7;
  ctx.beginPath();ctx.arc(x,y,27,0,TAU);
  ctx.strokeStyle='#e14c54';ctx.lineWidth=3;ctx.stroke();
  ctx.shadowBlur=0;
  ctx.beginPath();ctx.roundRect(x-22,y-11,44,22,5);
  ctx.fillStyle='#182028';ctx.fill();ctx.strokeStyle='#e14c54';ctx.lineWidth=1.5;ctx.stroke();
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 14px system-ui,sans-serif';
  ctx.fillStyle='#ffcfce';ctx.fillText(Math.max(0,info.bombRemaining).toFixed(1),x,y+.5);
  if(info.defuse){
    const label=info.defuse.remaining.toFixed(1)+'s';
    ctx.font='900 12px system-ui,sans-serif';
    const labelW=Math.max(37,ctx.measureText(label).width+12);
    ctx.beginPath();ctx.roundRect(x-labelW/2,y+31,labelW,19,4);
    ctx.fillStyle=info.defuse.hasKit?'#d2f1d7':'#322c17';ctx.fill();
    ctx.strokeStyle=info.defuse.hasKit?'#65af7f':'#f6d35d';ctx.lineWidth=1;ctx.stroke();
    // High-contrast kit green; no-kit yellow.
    ctx.fillStyle=info.defuse.hasKit?'#205b38':'#f8db5b';
    ctx.fillText(label,x,y+40.5);
  }
  ctx.restore();
}
// Click any stat heading to cycle descending → ascending → original order.
const SCORE_COLUMNS=[
  {key:'kills_total',index:7,label:'Kills'},
  {key:'assists_total',index:8,label:'Assists'},
  {key:'deaths_total',index:9,label:'Deaths'},
  {key:'utility_damage_total',index:10,label:'Utility damage'},
  {key:'enemies_flashed_total',index:11,label:'Enemies flashed'},
  {key:'adr',index:null,label:'Average damage per round'},
  {key:'balance',index:12,label:'Money'},
];
function playerADR(pid,tick){
  const d=state.demo;
  if(!d || !Array.isArray(d.enemy_damage_events) || d.limits?.adr_available===false)return null;
  const played=[...(state.playerRoundPresence[pid]||[])].filter(i=>d.rounds[i]?.start<=tick).length;
  if(!played)return null;
  const hits=state.enemyDamageByPlayer.get(pid)||[];
  let lo=0,hi=hits.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(hits[mid].tick<=tick)lo=mid+1;else hi=mid;}
  return (lo?hits[lo-1].total:0)/played;
}
function scoreboardValue(p,column){
  return column.key==='adr'?playerADR(p[0],state.tick):currentStat(p,column.index,column.key);
}
function sortedScoreboardEntries(entries){
  const {key,direction}=state.scoreSort;
  if(!key)return entries.sort((a,b)=>a[0]-b[0]);
  const col=SCORE_COLUMNS.find(c=>c.key===key);
  return entries.sort((a,b)=>{
    const av=scoreboardValue(a,col),bv=scoreboardValue(b,col);
    if(av==null && bv!=null)return 1;
    if(av!=null && bv==null)return -1;
    const diff=av!=null&&bv!=null?Number(av)-Number(bv):0;
    return diff?(direction==='desc'?-diff:diff):(a[0]-b[0]);
  });
}
function updateScoreSortHeader(){
  document.querySelectorAll('.score-sort-btn').forEach(button=>{
    const {key,direction}=state.scoreSort,active=key===button.dataset.sort;
    button.classList.toggle('sorted',active);
    button.dataset.direction=active?direction:'';
    button.setAttribute('aria-pressed',String(active));
    const col=SCORE_COLUMNS.find(c=>c.key===button.dataset.sort);
    button.setAttribute('aria-label',`Sort by ${col.label}${active?', '+direction+'ending':''}`);
    button.title=col.label+(active?' · '+direction:'')+' · click to cycle descending / ascending / off';
  });
}
function setScoreSort(key){
  if(!state.demo)return;
  if(state.scoreSort.key===key){
    const direction=state.scoreSort.direction;
    state.scoreSort=direction==='desc'?{key,direction:'asc'}:{key:null,direction:null};
  }else state.scoreSort={key,direction:'desc'};
  updateScoreSortHeader();refreshPlayers(rosterAt(state.tick));
}
function roundKillCount(pid,tick=state.tick){
  if(!state.demo)return 0;
  const ri=currentRoundAt(tick);
  const ticks=state.roundKillTicks.get(ri+':'+pid)||[];
  let lo=0,hi=ticks.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(ticks[mid]<=tick)lo=mid+1;else hi=mid;}
  return lo;
}
function scoreboardRow(pid){
  let row=state.rosterRows.get(pid);
  if(row)return row;
  row=document.createElement('button');row.type='button';row.className='scoreboard-row';
  const person=document.createElement('span');person.className='scoreboard-person';
  const circle=document.createElement('span');circle.className='player-avatar';
  const info=document.createElement('span');info.className='score-player-info';
  const name=document.createElement('span');name.className='score-name';
  const skulls=document.createElement('span');skulls.className='player-kill-badge';skulls.textContent='☠ ×0';skulls.title='Kills this round (so far)';
  const health=document.createElement('span');health.className='player-health-score';health.textContent='100';health.title='100 / 100 HP';
  const bomb=document.createElement('span');bomb.className='bomb-badge';bomb.textContent='C4';bomb.hidden=true;bomb.title='Bomb carrier';
  const loadout=document.createElement('span');loadout.className='score-loadout';
  info.append(name,health,bomb);person.append(circle,info);row.append(person);
  const values=[];
  for(let i=0;i<SCORE_COLUMNS.length;i++){
    const cell=document.createElement('span');cell.className=i===SCORE_COLUMNS.length-1?'money':'';
    row.append(cell);values.push(cell);
  }
  row.append(loadout);
  row._bits={circle,name,skulls,health,bomb,loadout,values};
  row.addEventListener('click',()=>{
    if(state.selectedPlayers.has(pid))state.selectedPlayers.delete(pid);
    else state.selectedPlayers.add(pid);
    state.selectedKill=-1;state.selectedUtility=-1;
    updatePlayerFilter();
  });
  state.rosterRows.set(pid,row);
  return row;
}
function refreshPlayers(players){
  updateScoreboardTeamNames();
  const seen=new Set();
  for(const [side,holderId,countId] of [[3,'ctPlayers','ctCount'],[2,'tPlayers','tCount']]){
    const holder=$(holderId),entries=sortedScoreboardEntries(players.filter(p=>p[4]===side));
    let live=0;
    for(const p of entries){
      if(p[6]>0)live++;
      const pid=p[0],row=scoreboardRow(pid);seen.add(pid);
      // Reorder only when the sorted rank actually changes; do not recreate rows.
      const desired=Array.prototype.indexOf.call(holder.children,row);
      const index=entries.indexOf(p);
      if(desired!==index)holder.insertBefore(row,holder.children[index]||null);
      const bits=row._bits;
      row.classList.toggle('dead',p[6]<=0);
      row.classList.toggle('selected',state.selectedPlayers.has(pid));
      row.setAttribute('aria-pressed',String(state.selectedPlayers.has(pid)));
      row.title='Filter player: '+playerName(pid)+' (works while playing)';
      bits.circle.style.background=TEAM[side];
      setTextIfChanged(bits.name,playerName(pid));
      setTextIfChanged(bits.skulls,`☠ ×${roundKillCount(pid,state.tick)}`);
      const hp=clamp(Number(p[6])||0,0,100);
      if(bits.health._lastHp!==hp){
        setTextIfChanged(bits.health,Math.round(hp));
        bits.health.title=`${Math.round(hp)} / 100 HP`;
        bits.health.style.background=`linear-gradient(90deg,#427f47 0%,#427f47 ${hp}%,#9b464a ${hp}%,#9b464a 100%)`;
        bits.health.setAttribute('aria-label',`${Math.round(hp)} health points`);
        bits.health._lastHp=hp;
      }
      const gear=normalizedLoadout(pid);renderEquipment(bits.loadout,gear);bits.loadout.prepend(bits.skulls);
      bits.bomb.hidden=!gear.hasBomb;row.classList.toggle('bomb-carrier',gear.hasBomb);
      bits.loadout.title=gear.title;row.setAttribute('aria-label',playerName(pid)+', '+gear.title+(gear.hasBomb?', bomb carrier':''));
      SCORE_COLUMNS.forEach((col,ix)=>{
        const val=scoreboardValue(p,col),span=bits.values[ix];
        setTextIfChanged(span,val==null?'—':(col.key==='balance'?'$'+Math.round(val).toLocaleString():col.key==='adr'?Number(val).toFixed(1):String(Math.round(val))));
        span.classList.toggle('missing-stat',val==null);
      });
    }
    // Keep existing rows mounted across frames; DOM replacement during playback
    // previously detached the row between pointerdown and click.
    for(const node of [...holder.children]){
      if(!node.classList.contains('roster-placeholder') && !entries.some(p=>state.rosterRows.get(p[0])===node))node.remove();
    }
    const placeholders=[...holder.querySelectorAll('.roster-placeholder')];
    const missingCount=Math.max(0,5-entries.length);
    for(let i=placeholders.length;i<missingCount;i++){
      const missing=document.createElement('div');missing.className='scoreboard-row roster-placeholder';
      missing.innerHTML='<span class="scoreboard-person">—</span>'+SCORE_COLUMNS.map(()=>'<span>—</span>').join('');
      holder.append(missing);
    }
    for(let i=missingCount;i<placeholders.length;i++)placeholders[i].remove();
    setTextIfChanged($(countId),`${live} / ${entries.length}`);
  }
}// Empty selection means everyone; selecting scoreboard rows switches to a multi-player comparison.
function playerVisible(pid){return state.selectedPlayers.size===0 || (pid!==null && pid!==undefined && state.selectedPlayers.has(pid));}
function updatePlayerFilter(){
  state.lastPaintTime=0;
  const count=state.selectedPlayers.size;
  $('selectedPlayerCount').textContent=count?`${count} selected`:'All players';
  $('clearPlayerFilter').hidden=!count;
  state.lastKillSignature='';
  refreshEvents();refreshPlayers(rosterAt(state.tick));refreshActiveUtility();
}
function roundKills(){
  const ri=currentRoundAt(state.tick);
  const source=state.killsByRound?.get(ri) || (state.demo?.kills||[]).map((k,id)=>({...k,id}));
  return source.filter(k=>k.round===ri &&
   (playerVisible(k.killer)||playerVisible(k.victim)) &&
   (state.eventPlayer==='all'||k.killer===Number(state.eventPlayer)||k.victim===Number(state.eventPlayer)));
}
function roundUtility(){
  const ri=currentRoundAt(state.tick);
  const source=state.utilityByRound?.get(ri) || (state.demo?.utility||[]).map((u,id)=>({...u,id}));
  return source.filter(u=>u.round===ri && (!state.selectedUtilityTypes || state.selectedUtilityTypes.has(u.type)) &&
    playerVisible(u.owner) && (!state.utilityPlayers?.size || [u.owner,...[...(u.damage||[]),...(u.blinded||[]),...(u.victims||[])].map(v=>v.player)].some(v=>state.utilityPlayers.has(Number(v)))));
}
const UTIL_LABELS={smoke:'SMOKE',flash:'FLASH',he:'HE GRENADE',fire:'MOLOTOV / INCENDIARY',decoy:'DECOY'};
// The event dock stays the same height; this floating detail view provides the
// complete per-player impacts without cutting off names in short event cards.
function utilityImpacts(u){
  const damage=u.damage||((u.type!=='flash'&&u.victims)||[]);
  const blinds=u.blinded||((u.type==='flash'&&u.victims)||[]);
  return {damage,blinds};
}
function utilityImpactSummary(u){
  const {damage,blinds}=utilityImpacts(u);
  const grouped=new Map();
  for(const hit of damage){
    const key=hit.player??'unknown',a=grouped.get(key)||{player:key,hp:0,armor:0};
    a.hp+=Number(hit.damage)||0;a.armor+=Number(hit.armor_damage)||0;grouped.set(key,a);
  }
  const chunks=[];
  if(grouped.size){
    chunks.push([...grouped.values()].map(v=>`${playerName(v.player)} −${v.hp} HP${v.armor?` / −${v.armor} armor`:''}`).join(' · '));
  }
  if(blinds.length)chunks.push(blinds.map(b=>`${playerName(b.player)} blinded ${Number.isFinite(Number(b.duration))?Number(b.duration).toFixed(1)+'s':'unknown duration'}`).join(' · '));
  if(!chunks.length && ['he','fire'].includes(u.type))chunks.push('0 damage');
  return chunks.join(' · ');
}
function hideUtilityBreakdown(){const el=$('utilityDetail');if(el)el.hidden=true;}
function showUtilityBreakdown(u){
  const panel=$('utilityDetail');if(!panel||!u)return;
  panel.replaceChildren();panel.hidden=false;
  const header=document.createElement('div');header.className='utility-detail-header';
  const heading=document.createElement('strong');heading.textContent=(UTIL_LABELS[u.type]||u.type.toUpperCase())+' · '+playerName(u.owner);
  const close=document.createElement('button');close.type='button';close.textContent='×';close.className='utility-detail-close';close.setAttribute('aria-label','Close utility details');close.addEventListener('click',hideUtilityBreakdown);
  header.append(heading,close);panel.append(header);
  const {damage,blinds}=utilityImpacts(u);
  function section(label,items,formatter){
    const block=document.createElement('section');block.className='utility-detail-section';
    const title=document.createElement('h3');title.textContent=label;block.append(title);
    if(!items.length){const empty=document.createElement('span');empty.className='utility-detail-empty';empty.textContent='None recorded';block.append(empty);}
    else for(const i of items){const el=document.createElement('div');el.className='utility-detail-row';el.textContent=formatter(i);block.append(el);}
    panel.append(block);
  }
  const grouped=new Map();
  for(const hit of damage){const k=hit.player??'unknown',v=grouped.get(k)||{player:k,hp:0,armor:0,hits:0};v.hp+=Number(hit.damage)||0;v.armor+=Number(hit.armor_damage)||0;v.hits++;grouped.set(k,v);}
  if(grouped.size || ['he','fire'].includes(u.type)){
    section('DAMAGE', [...grouped.values()],hit=>`${playerName(hit.player)}  ·  −${hit.hp} HP${hit.armor?` · −${hit.armor} armor`:''}${hit.hits>1?` (${hit.hits} hits)`:''}`);
    if(!grouped.size){const empty=panel.querySelector('.utility-detail-empty');if(empty)empty.textContent='0 damage';}
  }
  if(blinds.length || u.type==='flash')section('BLINDED',blinds,hit=>`${playerName(hit.player)}  ·  ${Number.isFinite(Number(hit.duration))?Number(hit.duration).toFixed(2)+'s':'duration not recorded'}`);
  if(u.trajectory_id!=null){const tr=state.demo?.trajectories?.[u.trajectory_id];if(tr&&!tr.estimated){const text=document.createElement('p');text.className='utility-detail-hint';text.textContent='Recorded grenade flight';panel.append(text);}}
}

function refreshEvents(){
  const d=state.demo;if(!d)return;
  const ks=roundKills(),us=roundUtility();
  const visibleKills=ks.filter(k=>k.tick<=state.tick);
  $('killTotal').textContent=visibleKills.length+'/'+ks.length;$('utilityTotal').textContent=us.length;
  $('eventHint').textContent=state.eventTab==='kills'?'Select a kill to seek its exact tick. Markers show all round locations.':'Select utility for all damage and blinded players; detailed impacts open above.';
  const holder=$('eventList');holder.replaceChildren();
  const items=state.eventTab==='kills'?visibleKills:us;
  if(!items.length){const div=document.createElement('div');div.className='event-empty';div.textContent=state.eventTab==='kills'?(ks.length?'Kills will appear as the round plays.':'No kills for this round / player.'):'No recorded utility events for this round / player.';holder.append(div);return;}
  for(const item of items){
    const card=document.createElement('button');card.type='button';
    card.className='event-card'+((state.eventTab==='kills'?item.id===state.selectedKill:item.id===state.selectedUtility)?' chosen':'');
    if(state.eventTab==='kills'){
      const tracked=state.eventPlayer==='all'?state.selectedPlayers:new Set([Number(state.eventPlayer)]);
      const role=kdPerspective(item,tracked);
      card.classList.add('kd-'+role);
    }else{
      card.classList.add('utility-card');
    }
    const when=document.createElement('span');when.className='event-time';
    const round=d.rounds[item.round];when.textContent=`${mmss((item.tick??item.start-round.start)/d.tick_rate)}`;
    // Round-local time, not full match time.
    when.textContent='ROUND '+mmss(((item.tick??item.start)-round.start)/d.tick_rate)+' · TICK '+(item.tick??item.start);
    const title=document.createElement('span');title.className='event-title';
    const sub=document.createElement('span');sub.className='event-sub';
    if(state.eventTab==='kills'){
      const role=card.classList.contains('kd-kill')?'KILL':card.classList.contains('kd-death')?'DEATH':'K/D';
      title.textContent=`${playerName(item.killer)} → ${playerName(item.victim)}`;
      sub.textContent=(item.headshot?'HEADSHOT · ':'')+item.weapon;
      card.title=`${role} · ${when.textContent} · ${title.textContent} · ${sub.textContent}`;
      card.setAttribute('aria-label',card.title);
      card.addEventListener('click',()=>{state.selectedKill=item.id;seek(item.tick);refreshEvents();});
    }else{
      // Short utility names preserve space for the thrower's name in this fixed-height dock.
      const shortType=({fire:'FIRE',he:'HE',flash:'FLASH',smoke:'SMOKE',decoy:'DECOY'})[item.type]||item.type.toUpperCase();
      title.textContent=`${shortType} · ${playerName(item.owner)}`;
      sub.textContent=utilityImpactSummary(item);
      card.title=`${UTIL_LABELS[item.type]||item.type} · ${playerName(item.owner)} · ${when.textContent} · ${sub.textContent}`;
      card.setAttribute('aria-label',card.title);
      card.addEventListener('click',()=>{
        state.selectedUtility=item.id;
        state.showUtility=true;$('toggleUtility').classList.add('active');$('toggleUtility').setAttribute('aria-pressed','true');
        // Show a visible developing effect for long-lasting grenade types.
        const showTick=['smoke','fire','decoy'].includes(item.type)
          ? Math.min(item.end-1,item.start+Math.round(d.tick_rate*1.3)) : item.start+1;
        seek(showTick);refreshEvents();showUtilityBreakdown(item);
      });
    }
    card.append(when,title,sub);holder.append(card);
  }
}
function gridBackground(){
  // Grid is infinite across the map viewport (not a square bounding box).
  // Only visible lines are drawn, so extreme pans/zooms remain inexpensive.
  const a=inverseCamera(0,0),b=inverseCamera(state.viewW,state.viewH);
  const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x);
  const minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y);
  const spacing=Math.max(64,64*Math.pow(2,Math.ceil(Math.log2(1/state.zoom))));
  ctx.lineWidth=1/state.zoom;
  const left=Math.floor(minX/spacing)*spacing,right=Math.ceil(maxX/spacing)*spacing;
  const top=Math.floor(minY/spacing)*spacing,bottom=Math.ceil(maxY/spacing)*spacing;
  for(let x=left;x<=right;x+=spacing){ctx.beginPath();ctx.strokeStyle=Math.round(x/spacing)%4===0?'#50657650':'#53677a26';ctx.moveTo(x,minY);ctx.lineTo(x,maxY);ctx.stroke();}
  for(let y=top;y<=bottom;y+=spacing){ctx.beginPath();ctx.strokeStyle=Math.round(y/spacing)%4===0?'#50657650':'#53677a26';ctx.moveTo(minX,y);ctx.lineTo(maxX,y);ctx.stroke();}
}

function radarPoint(pos){
  if(!pos || pos.length<2)return null;
  if(state.lowerImage&&state.floorView==='layered'&&!visibleRadarFloor(floorOf(pos[2]??0)))return null;
  const p=worldToRadar([0,pos[0],pos[1],pos[2]||0]);
  return p.every(Number.isFinite)?p:null;
}
function playerPositionAt(tick,pid){
  if(pid===null || pid===undefined)return null;
  let lo=0,hi=state.frameTicks.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(state.frameTicks[mid]<=tick)lo=mid+1;else hi=mid;}
  const frame=state.demo.frames[Math.max(0,lo-1)];
  const p=frame?.[1].find(p=>p[0]===pid);
  return p?[p[1],p[2],p[3]]:null;
}
function circleArea(pos,radius,color,opacity=1){
  const p=radarPoint(pos);if(!p)return;
  const meta=state.map;
  const bounds=state.demo.bounds;
  const rx=meta?.calibrated&&state.image?radius/meta.scale:radius*896/(bounds.x[1]-bounds.x[0]);
  const ry=meta?.calibrated&&state.image?radius/meta.scale:radius*896/(bounds.y[1]-bounds.y[0]);
  if(!Number.isFinite(rx)||!Number.isFinite(ry))return;
  ctx.save();ctx.globalAlpha=opacity;ctx.beginPath();ctx.ellipse(p[0],p[1],Math.abs(rx),Math.abs(ry),0,0,TAU);
  ctx.fillStyle=color+'22';ctx.fill();ctx.setLineDash([11,7]);ctx.lineWidth=3;ctx.strokeStyle=color;ctx.stroke();ctx.setLineDash([]);ctx.restore();
}
// Utility-only labels use the compact option; all existing player, kill,
// and bomb labels retain their original font and outline.
function radarLabel(label,x,y,color='#e8f1ff',compact=false){
  ctx.save();ctx.font=compact?'700 11px system-ui,sans-serif':'800 17px system-ui,sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.lineWidth=compact?2.5:5;ctx.strokeStyle=compact?'#06101ec9':'#06101ee8';
  ctx.strokeText(label,x,y);ctx.fillStyle=color;ctx.fillText(label,x,y);ctx.restore();
}
function paintUtility(){
  if(!state.showUtility || !state.demo)return;
  const t=state.tick,d=state.demo;
  for(const u of d.utility||[]){
    if(t<u.start || t>u.end || !u.pos || !playerVisible(u.owner) || !utilityTypeVisible(u.type))continue;
    const life=clamp((t-u.start)/(u.end-u.start||1),0,1),s=(t-u.start)/d.tick_rate;
    const p=radarPoint(u.pos);if(!p)continue;
    if(u.type==='smoke'){
      circleArea(u.pos,145*Math.min(1,s/1.3),'#a3b4c9',1);
      ctx.save();ctx.beginPath();ctx.arc(p[0],p[1],16,0,TAU);ctx.fillStyle='#d9e5ee';ctx.strokeStyle='#243240';ctx.lineWidth=3;ctx.fill();ctx.stroke();ctx.restore();
      radarLabel('S',p[0],p[1],'#23313a',true);
    }else if(u.type==='fire'){
      circleArea(u.pos,175*Math.min(1,s/.7),'#fd8d42',1);
      ctx.save();for(let j=0;j<9;j++){const a=j*TAU/9+s*.6,dx=Math.cos(a)*18,dy=Math.sin(a)*18;
        ctx.beginPath();ctx.arc(p[0]+dx,p[1]+dy,10+3*Math.sin(s*5+j),0,TAU);ctx.fillStyle='#ec64354f';ctx.fill();}ctx.restore();
    }else if(u.type==='he'){
      circleArea(u.pos,350,'#ffa96b',Math.max(.25,1-life));
    }else if(u.type==='flash'){
      circleArea(u.pos,230,'#fff6c6',Math.max(.3,1-life));
      radarLabel('FLASH',p[0],p[1]-18,'#fff9da',true);
    }else if(u.type==='decoy'){
      circleArea(u.pos,60+15*Math.sin(s*3)**2,'#b4e9d0',.7);
      radarLabel('D',p[0],p[1],'#d5ffe9',true);
    }
    if(state.selectedUtility>=0 && (d.utility||[])[state.selectedUtility]===u){
      ctx.save();ctx.strokeStyle='#d3f6a2';ctx.lineWidth=4;ctx.setLineDash([10,6]);ctx.beginPath();ctx.arc(p[0],p[1],37,0,TAU);ctx.stroke();ctx.restore();
    }
    if(u.type==='smoke'||u.type==='fire'){
      const remaining=Math.max(0,(u.end-t)/d.tick_rate).toFixed(1);
      radarLabel(`${u.type==='smoke'?'SMOKE':'FIRE'} ${remaining}s${u.estimated_end?' ≈':''}`,p[0],p[1]+20,
        u.type==='smoke'?'#dbe7ed':'#ffbd80',true);
    }
    if(u.type==='he')for(const v of u.victims||[]){
      if(!playerVisible(v.player)||v.tick<t-48 || v.tick>t+8)continue;
      const point=radarPoint(v.pos || playerPositionAt(v.tick,v.player));
      if(point)radarLabel('−'+v.damage+' HP',point[0],point[1]-32,'#ffb189',true);
    }
  }
  paintTrajectories(t,d);
}
function paintEliminations(){
  if(!state.showDeaths || !state.demo)return;
  const ks=roundKills().filter(k=>k.tick<=state.tick);
  ks.forEach((k,index)=>{
    const from=playerVisible(k.killer)?radarPoint(k.killer_pos||playerPositionAt(k.tick,k.killer)):null;
    const to=playerVisible(k.victim)?radarPoint(k.victim_pos||playerPositionAt(k.tick,k.victim)):null;
    const active=k.id===state.selectedKill||Math.abs(state.tick-k.tick)<30;
    ctx.save();ctx.globalAlpha=active?1:.48;
    if(from&&to){ctx.lineWidth=active?4:2;ctx.strokeStyle=active?'#edffb5':'#dfe6ee';ctx.setLineDash([7,6]);ctx.beginPath();ctx.moveTo(...from);ctx.lineTo(...to);ctx.stroke();ctx.setLineDash([]);}
    if(from){ctx.beginPath();ctx.arc(...from,active?13:9,0,TAU);ctx.strokeStyle='#bbffa0';ctx.lineWidth=3;ctx.stroke();radarLabel('K',from[0],from[1],'#edffd9');}
    if(to){ctx.strokeStyle='#ff7070';ctx.lineWidth=active?5:3;const r=active?17:12;
      ctx.beginPath();ctx.moveTo(to[0]-r,to[1]-r);ctx.lineTo(to[0]+r,to[1]+r);ctx.moveTo(to[0]+r,to[1]-r);ctx.lineTo(to[0]-r,to[1]+r);ctx.stroke();}
    ctx.restore();
  });
}
// Grenade flight is tick-synchronized; no path remains after activation/landing.
// The smoke/fire/decoy EFFECT continues separately and is never removed here.
function trajectorySegment(tr,t){
  const raw=tr.points||[];
  if(!raw.length||t<tr.start)return [];
  const points=raw.filter(p=>p[0]<=t).map(p=>p.slice());
  if(t>=tr.end)return points;
  const next=raw.find(p=>p[0]>t);
  const prev=points.at(-1);
  if(prev&&next&&next[0]>prev[0]){
    const k=(t-prev[0])/(next[0]-prev[0]);
    points.push([t,...prev.slice(1,4).map((v,i)=>v+(next[i+1]-v)*k)]);
  }
  return points;
}
function paintTrajectories(t,d){
  const colors={flash:'#fff3ad',smoke:'#d3e4f0',he:'#ffa76f',fire:'#ff8653',decoy:'#9ddfd4'};
  (d.trajectories||[]).forEach((tr,index)=>{
    if(!playerVisible(tr.owner)||!utilityTypeVisible(tr.type)||!tr.points?.length||t<tr.start)return;
    if(state.lowerImage && state.floorView==='layered' && state.map?.lower_z_max!=null &&
       (Number(tr.points[0][3])<=Number(state.map.lower_z_max)?'lower':'upper')!==state.layeredFloor)return;
    const effect=state.trajectoryEffects.get(index);
    // A live projectile trail exists ONLY in flight. Once a smoke blooms,
    // HE/flash pops, or fire ignites, remove the entire flight trace.
    // Never show an unrecorded endpoint/estimated flight or a stationary
    // projectile lingering inside an active smoke cloud.
    if(tr.estimated || !tr.points || tr.points.length<2)return;
    const activate=effect?.start>=tr.start?effect.start:tr.end;
    const flightEnd=Math.min(tr.flight_end??tr.end,activate);
    if(t>=flightEnd)return;
    const points=trajectorySegment(tr,t);
    if(!points.length)return;
    const color=colors[tr.type]||'#e3eef6';
    const launch=radarPoint(tr.points[0].slice(1));
    const current=radarPoint(points.at(-1).slice(1));
    const airborne=true;
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.globalAlpha=1;
    ctx.beginPath();let started=false;
    for(const p of points){const q=radarPoint(p.slice(1));if(!q)continue;if(!started){ctx.moveTo(...q);started=true;}else ctx.lineTo(...q);}
    ctx.stroke();ctx.setLineDash([]);
    if(launch){ctx.beginPath();ctx.arc(...launch,9,0,TAU);ctx.fillStyle='#101923';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=3;ctx.stroke();
      radarLabel('↗ '+playerName(tr.owner),launch[0],launch[1]-22,color,true);}
    if(current){ctx.beginPath();ctx.arc(...current,airborne?10:6,0,TAU);ctx.fillStyle=color;ctx.fill();
      ctx.lineWidth=2;ctx.strokeStyle='#101923';ctx.stroke();
      if(airborne)radarLabel(UTIL_LABELS[tr.type]||tr.type.toUpperCase(),current[0],current[1]-20,color,true);}
    ctx.restore();
  });
}

// Event durations take precedence. Sparse sampled flash values are converted to
// start/duration intervals only if no usable event overlaps that player at the time.
function buildFlashIntervals(d){
  const intervals=(d.blinds||[]).filter(b=>b.player!=null&&Number.isFinite(Number(b.duration))&&b.duration>0)
    .map(b=>({player:b.player,start:b.tick,end:b.tick+b.duration*d.tick_rate,source:'event'}));
  (d.players||[]).forEach((_,pid)=>{
    let previous=0,open=null,prevTick=null;
    // loadReplay builds per-player histories first, so finding this player's
    // sample no longer searches every other player's snapshot on every tick.
    const history=state.playerHistories?.[pid];
    for(const frame of history||d.frames){
      const record=history?frame[1]:frame[1].find(p=>p[0]===pid);
      if(!record)continue;
      const duration=Number(record[13])||0;
      const t=frame[0];
      if(duration>0 && (!open || previous<=0 || (prevTick!=null&&t-prevTick>3*d.sample_stride))){
        if(open)intervals.push(open);
        open={player:pid,start:t,end:t+duration*d.tick_rate,source:'sample'};
      }else if(open && duration>0 && duration>previous+0.2){
        intervals.push(open);open={player:pid,start:t,end:t+duration*d.tick_rate,source:'sample'};
      }else if(open && duration>0){
        // Keep the first duration for samples reporting a constant original blind time;
        // if the parser returns a decreasing value its scheduled end will be similar.
        open.end=Math.min(open.end,t+duration*d.tick_rate);
      }
      if(duration<=0 && open){intervals.push(open);open=null;}
      previous=duration;prevTick=t;
    }
    if(open)intervals.push(open);
  });
  return intervals;
}
// All utility blind details use the SAME intervals as the live radar.
// Match by closest real flash detonation, including teammates and players whose
// player_blind event has no owner. Unmatched sample intervals are not fabricated
// into extra grenades; they may augment an existing confirmed flash.
function normalizeFlashUtilityImpacts(d, intervals){
  const flashes=(d.utility||[]).filter(u=>u.type==='flash');
  if(!flashes.length)return;
  const assigned=new Map(flashes.map(u=>[u,new Map()]));
  const rate=d.tick_rate||64;
  const nearFlash=(tick,thrower,entity)=>{
    const options=flashes.filter(u=>Math.abs(u.start-tick)<=Math.round(rate*.65) &&
       (thrower==null||u.owner==null||thrower===u.owner) &&
       (entity==null||u.entity==null||entity===u.entity));
    options.sort((a,b)=>Math.abs(a.start-tick)-Math.abs(b.start-tick));
    return options[0]||null;
  };
  // Exact event duration and start are preferred by buildFlashIntervals.
  for(const b of d.blinds||[]){
    if(b.player==null)continue;
    const u=nearFlash(b.tick,b.thrower,b.entity);if(!u)continue;
    const timed=intervals.filter(i=>i.player===b.player&&i.start<=b.tick+Math.round(rate*.3)&&i.end>b.tick)
      .sort((a,z)=>(a.source==='event'?0:1)-(z.source==='event'?0:1))[0];
    const duration=timed ? Math.max(0,(timed.end-Math.min(b.tick,timed.start))/rate):Number(b.duration);
    if(Number.isFinite(duration)&&duration>0)assigned.get(u).set(b.player,{player:b.player,tick:b.tick,duration:Number(duration.toFixed(2))});
  }
  // A player can be blinded with no usable player_blind actor field: infer the
  // connection from their observed radar flash start ONLY when unambiguous.
  for(const interval of intervals){
    const opts=flashes.filter(u=>interval.start>=u.start-Math.round(rate*.15)&&interval.start<=u.start+Math.round(rate*.4));
    if(opts.length!==1)continue;
    const u=opts[0],victims=assigned.get(u);
    if(victims.has(interval.player))continue;
    const duration=(interval.end-u.start)/rate;
    if(duration>0&&duration<=12)victims.set(interval.player,{player:interval.player,tick:interval.start,duration:Number(duration.toFixed(2)),source:'sample'});
  }
  for(const u of flashes){u.blinded=[...assigned.get(u).values()].sort((a,b)=>a.player-b.player);u.victims=u.blinded;}
}

// Some demoparser versions keep sampling a stationary grenade entity until the
// smoke expires. Find touchdown even when the source did not trim those points.
function flightEndOf(tr){
  if(!tr?.points?.length)return tr?.end??0;
  const points=tr.points;
  let last=points.length-1;
  const final=points[last];
  while(last>0 && Math.hypot(points[last-1][1]-final[1],points[last-1][2]-final[2],(points[last-1][3]||0)-(final[3]||0))<=2.5)last--;
  const trim=last>0 && points.length-last>=3 && final[0]-points[last][0]>=12;
  return Math.min(tr.flight_end??Infinity,trim?points[last][0]:tr.end);
}

function flashRemaining(pid,tick){
  const intervals=state.flashIntervalsByPlayer?.get(pid) || state.flashIntervals;
  const relevant=intervals.filter(i=>i.player===pid&&i.start<=tick&&tick<i.end);
  const actual=relevant.filter(i=>i.source==='event');
  return (actual.length?actual:relevant).reduce((max,i)=>Math.max(max,(i.end-tick)/state.demo.tick_rate),0);
}

// Canvas fills the entire rectangular map pane. Its *radar image* always
// retains a square aspect ratio; zoom/pan are unconstrained by that square.
function resizeRadar(){
  const r=canvas.getBoundingClientRect();
  const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
  const dpr=Math.min(window.devicePixelRatio||1,2);
  if(w===state.viewW && h===state.viewH && state.pixelRatio===dpr)return;
  state.viewW=w;state.viewH=h;state.pixelRatio=dpr;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  state.backdrop=null;
}
function baseScale(){return Math.min(state.viewW/1024,state.viewH/sceneHeight());}
function canvasPoint(event){
  const rect=canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)*state.viewW/rect.width,y:(event.clientY-rect.top)*state.viewH/rect.height};
}
function inverseCamera(x,y){
  const base=baseScale();
  return {x:512+((x-state.viewW/2)/base-state.panX)/state.zoom,
          y:sceneCenterY()+((y-state.viewH/2)/base-state.panY)/state.zoom};
}
// Shared camera math for painting, Ctrl selection, and persistent map annotations.
function radarToScreen(x,y){
  const base=baseScale(),scale=base*state.zoom;
  return {x:state.viewW/2+base*state.panX+scale*(x-512),
          y:state.viewH/2+base*state.panY+scale*(y-sceneCenterY())};
}
function playersInScreenRect(ax,ay,bx,by,rows=tickFrameAt(state.tick)){
  const minX=Math.min(ax,bx),maxX=Math.max(ax,bx);
  const minY=Math.min(ay,by),maxY=Math.max(ay,by);
  const found=new Set();
  for(const p of rows){
    if(p[4]!==2&&p[4]!==3)continue;
    const xy=worldToRadar(p);if(!xy.every(Number.isFinite))continue;
    const screen=radarToScreen(...xy);
    // Small tolerance lets a narrow box include a player's marker.
    if(screen.x>=minX-8&&screen.x<=maxX+8&&screen.y>=minY-8&&screen.y<=maxY+8)found.add(p[0]);
  }
  return found;
}
function commitRadarSelection(ax,ay,bx,by){
  const found=playersInScreenRect(ax,ay,bx,by);
  if(!found.size){notify('No players inside selection. Filter unchanged.',false,2200);return false;}
  state.selectedPlayers=found;
  state.selectedKill=-1;state.selectedUtility=-1;
  updatePlayerFilter();
  notify(`${found.size} player${found.size===1?'':'s'} selected on radar. Use Show everyone to clear.`,false,2500);
  return true;
}
function paintRadarAnnotations(){
  if(!state.radarStrokes.length)return;
  ctx.save();ctx.strokeStyle='#ffffff';ctx.lineWidth=Math.max(.08,2.8/(baseScale()*state.zoom));
  ctx.lineJoin='round';ctx.lineCap='round';
  for(const stroke of state.radarStrokes){
    if(!stroke.length)continue;
    ctx.beginPath();ctx.moveTo(stroke[0].x,stroke[0].y);
    if(stroke.length===1){ctx.lineTo(stroke[0].x+.01,stroke[0].y+.01);}
    else for(let i=1;i<stroke.length;i++)ctx.lineTo(stroke[i].x,stroke[i].y);
    ctx.stroke();
  }
  ctx.restore();
}
function paintRadarSelection(){
  const drag=state.dragPointer;
  if(!drag||drag.mode!=='select')return;
  const x=Math.min(drag.startX,drag.x),y=Math.min(drag.startY,drag.y);
  const width=Math.abs(drag.x-drag.startX),height=Math.abs(drag.y-drag.startY);
  ctx.save();ctx.setTransform(state.pixelRatio,0,0,state.pixelRatio,0,0);
  ctx.fillStyle='rgba(181,230,129,.14)';ctx.fillRect(x,y,width,height);
  ctx.strokeStyle='#b5e681';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.strokeRect(x,y,width,height);
  ctx.restore();
}
function changeZoom(factor,x=state.viewW/2,y=state.viewH/2){
  state.lastPaintTime=0;
  const next=clamp(state.zoom*factor,.25,32),anchor=inverseCamera(x,y);
  state.zoom=next;
  state.panX=(x-state.viewW/2)/baseScale()-(anchor.x-512)*next;
  state.panY=(y-state.viewH/2)/baseScale()-(anchor.y-sceneCenterY())*next;
  $('zoomValue').textContent=Math.round(next*100)+'%';
}
function resetView(){state.lastPaintTime=0;state.zoom=1;state.panX=0;state.panY=0;if($('zoomValue'))$('zoomValue').textContent='100%';}

function paintBlinds(rows){
  if(!state.showUtility||!utilityTypeVisible('flash'))return;
  for(const p of rows){
    if(!visibleRadarFloor(floorOf(p[3])))continue;
    // Never use a raw snapshot's initial duration as a persistent value: it can be
    // constant for the entire flash. Derive the remaining time from activation tick.
    const flash=flashRemaining(p[0],state.tick);
    if(flash<=.1)continue;
    const xy=worldToRadar(p);
    ctx.save();ctx.strokeStyle='#fff7b6';ctx.lineWidth=4;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.arc(xy[0],xy[1],26,0,TAU);ctx.stroke();ctx.setLineDash([]);
    radarLabel('BLIND '+flash.toFixed(1)+'s',xy[0],xy[1]+34,'#fff5a2',true);ctx.restore();
  }
}
function paintShots(){
  if(!state.demo)return;
  const t=state.tick,rate=state.demo.tick_rate;
  const shots=state.demo.shots||[];
  let lo=0,hi=shots.length;
  const earliest=t-Math.round(rate*.115);
  while(lo<hi){const m=(lo+hi)>>1;if(shots[m].tick<earliest)lo=m+1;else hi=m;}
  for(let i=lo;i<shots.length&&shots[i].tick<=t;i++){
    const shot=shots[i];
    if(!playerVisible(shot.owner))continue;
    const pos=shot.pos||playerPositionAt(shot.tick,shot.owner);
    if(!pos||shot.yaw==null)continue;
    const p=radarPoint(pos);if(!p)continue;
    const a=Number(shot.yaw)*Math.PI/180,dx=Math.cos(a),dy=-Math.sin(a);
    const fade=clamp(1-(t-shot.tick)/(rate*.115),0,1);
    const px=p[0]+dx*14,py=p[1]+dy*14;
    ctx.save();ctx.globalAlpha=.9*fade;ctx.strokeStyle='#ffeac0';ctx.lineCap='round';
    ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+dx*14,py+dy*14);ctx.stroke();
    ctx.strokeStyle='#ffd69a';ctx.lineWidth=1.5;
    for(const delta of [-.46,.46]){
      const da=a+delta,ux=Math.cos(da),uy=-Math.sin(da);
      ctx.beginPath();ctx.moveTo(px+dx*4,py+dy*4);ctx.lineTo(px+dx*8+ux*8,py+dy*8+uy*8);ctx.stroke();
    }
    ctx.restore();
  }
}
function paint(){
  resizeRadar();
  const d=state.demo;
  const dpr=state.pixelRatio,w=state.viewW,h=state.viewH;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  // The blue tactical background covers the complete rectangular viewport,
  // including areas beyond the radar, at every zoom and pan position.
  ctx.fillStyle='#192630';ctx.fillRect(0,0,w,h);
  if(!state.backdrop){
    const bg=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*.8);
    bg.addColorStop(0,'#263a45');bg.addColorStop(1,'#141d29');
    state.backdrop=bg;
  }
  ctx.fillStyle=state.backdrop;ctx.fillRect(0,0,w,h);
  const base=baseScale(),scale=base*state.zoom;
  ctx.setTransform(dpr*scale,0,0,dpr*scale,
    dpr*(w/2+base*state.panX-scale*512),dpr*(h/2+base*state.panY-scale*sceneCenterY()));
  ctx.save();
  if(!state.image||!state.map){gridBackground();}
  else{
    if(isStacked()){
      ctx.save();ctx.globalAlpha=.94;ctx.drawImage(state.upperImage,0,0,1024,1024);
      ctx.drawImage(state.lowerImage,0,LOWER_ORIGIN,1024,1024);ctx.restore();
      ctx.fillStyle='#0b142115';ctx.fillRect(0,0,1024,1024);ctx.fillRect(0,LOWER_ORIGIN,1024,1024);
      ctx.fillStyle='#e2eaf0';ctx.font='800 24px system-ui';ctx.fillText('UPPER FLOOR',20,39);
      ctx.fillText('LOWER FLOOR',20,LOWER_ORIGIN+39);
    }else{
      ctx.save();ctx.globalAlpha=.93;
      if(state.floorView==='layered'&&state.lowerImage){ctx.drawImage(state.layeredFloor==='upper'?state.upperImage:state.lowerImage,0,0,1024,1024);}
      else ctx.drawImage(state.upperImage||state.image,0,0,1024,1024);
      ctx.restore();
      ctx.fillStyle='#0b142112';ctx.fillRect(0,0,1024,1024);
    }
    if(state.showGrid){ctx.strokeStyle='#b9d6ee36';ctx.lineWidth=1;for(let z=0;z<=1024;z+=128){ctx.beginPath();ctx.moveTo(z,0);ctx.lineTo(z,1024);ctx.moveTo(0,z);ctx.lineTo(1024,z);if(isStacked()){ctx.moveTo(z,LOWER_ORIGIN);ctx.lineTo(z,LOWER_ORIGIN+1024);ctx.moveTo(0,LOWER_ORIGIN+z);ctx.lineTo(1024,LOWER_ORIGIN+z);}ctx.stroke();}}
  }
  if(!state.demo){ctx.restore();return;}
  paintUtility();
  // Persistent kill trails belong beneath all living players, never above them.
  paintEliminations();
  paintRadarAnnotations();
  const rows=tickFrameAt(state.tick).filter(p=>(p[4]===2||p[4]===3)&&playerVisible(p[0]));
  const roundIndex=currentRoundAt(state.tick);
  const deadIds=new Set((state.killsByRound?.get(roundIndex)||(d.kills||[]).filter(k=>k.round===roundIndex))
    .filter(k=>k.tick<=state.tick).map(k=>k.victim));
  const bomb=bombStateAt(state.tick);
  const isDead=p=>p[6]<=0||deadIds.has(p[0]);
  // Dead players are ghosts on a BACK layer: smaller, dimmer, without labels,
  // HP, or direction indicators. Alive labels and markers always paint last.
  // for(const p of rows.filter(isDead)) — dead pass remains below living pass.
  for(const p of rows.filter(p=>isDead(p)&&visibleRadarFloor(floorOf(p[3])))){
    const [x,y]=worldToRadar(p);
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    ctx.save();ctx.globalAlpha=.17;
    ctx.beginPath();ctx.arc(x,y,8,0,TAU);ctx.fillStyle=TEAM[p[4]];ctx.fill();
    ctx.strokeStyle='#aeb9c2';ctx.lineWidth=1;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-3.6,y-3.6);ctx.lineTo(x+3.6,y+3.6);
    ctx.moveTo(x+3.6,y-3.6);ctx.lineTo(x-3.6,y+3.6);
    ctx.strokeStyle='#e4e9ee';ctx.lineWidth=1.6;ctx.stroke();ctx.restore();
  }
  if(bomb.status==='dropped')paintBomb(bomb);
  // for(const p of rows.filter(p=>!isDead(p))) — living markers on top.
  for(const p of rows.filter(p=>!isDead(p)&&visibleRadarFloor(floorOf(p[3])))){
    const [x,y]=worldToRadar(p);
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    const sideColor=TEAM[p[4]];
    ctx.save();
    if(bomb.status==='carried'&&bomb.player===p[0])paintC4Glyph(x,y,sideColor);
    else{
      ctx.shadowColor='#03060b';ctx.shadowBlur=7;
      ctx.beginPath();ctx.arc(x,y,11.5,0,TAU);ctx.fillStyle=sideColor;ctx.fill();
      ctx.shadowBlur=0;ctx.lineWidth=1.6;ctx.strokeStyle='#101b25';ctx.stroke();
    }
    // CS2 yaw: world +X is right; world +Y is screen-up.
    if(p[14]!=null){
      const rad=Number(p[14])*Math.PI/180,dx=Math.cos(rad),dy=-Math.sin(rad);
      const sx=-dy,sy=dx;
      ctx.beginPath();ctx.moveTo(x+dx*19,y+dy*19);
      ctx.lineTo(x+dx*7+sx*5,y+dy*7+sy*5);
      ctx.lineTo(x+dx*7-sx*5,y+dy*7-sy*5);ctx.closePath();
      ctx.fillStyle='#f4fcff';ctx.fill();ctx.lineWidth=1;ctx.strokeStyle='#101b25';ctx.stroke();
    }
    if(state.showNames){
      const name=d.players[p[0]]?.name||'Unknown';
      ctx.font='750 18px system-ui,-apple-system,"Segoe UI",sans-serif';
      ctx.textAlign='center';ctx.textBaseline='bottom';ctx.lineJoin='round';
      ctx.strokeStyle='#060b11f0';ctx.lineWidth=4;ctx.strokeText(name,x,y-21);
      ctx.fillStyle='#f9fbff';ctx.fillText(name,x,y-21);
      const textWidth=ctx.measureText(name).width;
      const hpx=clamp(Number(p[6])||0,0,100),bx=x+textWidth/2+7,by=y-42;
      ctx.fillStyle='#923e44';ctx.fillRect(bx,by,5,21);
      ctx.fillStyle='#6ed27b';const filled=21*hpx/100;
      ctx.fillRect(bx,by+21-filled,5,filled);
      ctx.strokeStyle='#0b1422';ctx.lineWidth=1;ctx.strokeRect(bx-.5,by-.5,6,22);
    }
    ctx.restore();
  }
  paintShots();paintBlinds(rows.filter(p=>!isDead(p)));
  if(bomb.status==='planted')paintBomb(bomb);
  ctx.restore();
  paintRadarSelection();
}
function animate(ts){
  const step=state.lastAnimation?Math.min(.15,(ts-state.lastAnimation)/1000):0;
  state.lastAnimation=ts;
  if(state.playing&&state.demo){
    state.tick+=step*state.demo.tick_rate*state.speed;
    if(state.tick>=state.demo.end){state.tick=state.demo.end;setPlayback(false);}
    updateUI();
  }
  if(state.playing || state.dragPointer || ts-state.lastPaintTime>=1000/30){
    paint();state.lastPaintTime=ts;
  }
  requestAnimationFrame(animate);
}

function setUploadProgress(stage,percentage=null,detail=''){
  const box=$('demoUploadProgress');if(!box)return;
  box.hidden=false;box.setAttribute('aria-busy',stage==='complete'?'false':'true');
  const title=$('uploadStage'),bar=$('uploadBar'),info=$('uploadInfo');
  title.textContent=stage==='upload'?'Uploading demo…':stage==='parse'?'Parsing demo…':stage==='load'?'Loading replay…':stage==='complete'?'Replay ready':'Preparing…';
  bar.classList.toggle('indeterminate',percentage==null);
  bar.style.width=percentage==null?'35%':Math.max(0,Math.min(100,percentage))+'%';
  info.textContent=detail||(percentage==null?'In progress':Math.round(percentage)+'%');
}
function uploadWithProgress(form){
  return new Promise((resolve,reject)=>{
    const req=new XMLHttpRequest();req.open('POST','/api/demos');req.responseType='json';
    req.setRequestHeader('X-OpenReplay-CSRF',window.__openReplayCSRF||'');
    req.upload.onprogress=e=>{
      if(e.lengthComputable)setUploadProgress('upload',e.loaded/e.total*100,
        `${(e.loaded/1048576).toFixed(1)} / ${(e.total/1048576).toFixed(1)} MB`);
      else setUploadProgress('upload',null,`${(e.loaded/1048576).toFixed(1)} MB sent`);
    };
    req.onload=()=>{
      const obj=req.response||{};
      if(req.status>=200&&req.status<300)resolve(obj);
      else reject(new Error(obj.detail||'Upload failed'));
    };
    req.onerror=()=>reject(new Error('Upload interrupted. Check that OpenReplay is running.'));
    req.onabort=()=>reject(new Error('Upload cancelled'));
    req.send(form);
  });
}
async function uploadFile(file){
  if(!file)return;
  if(!file.name.toLowerCase().endsWith('.dem')){notify('Please choose a CS2 .dem file (not .bz2 or a ZIP).',true);return;}
  if(state.busy){notify('A demo is currently being uploaded or parsed.',true);return;}
  state.busy=true;setPlayback(false);
  $('fileName').textContent=file.name+' — uploading';$('viewStatus').textContent='UPLOADING DEMO';
  $('openDemo').disabled=true;
  try{
    const form=new FormData();form.append('file',file,file.name);
    setUploadProgress('upload',0,'Starting upload');
    window.__openReplayCSRF=(await secureSession).csrf;
    const result=await uploadWithProgress(form);
    $('fileName').textContent=file.name+' — parsing';$('viewStatus').textContent='PARSING DEMO FILE';
    setUploadProgress('parse',null,'Extracting match data · time varies by demo size');
    notify('Extracting rounds and player positions…',false,6500);
    let job;
    for(;;){
      await new Promise(r=>setTimeout(r,900));
      let s=await fetch(`/api/demos/${result.id}/status`);
      if(!s.ok)throw new Error('Lost contact with parser');
      job=await s.json();
      if(job.status==='ready')break;
      if(job.status==='error')throw new Error(job.error||'Demo parsing failed');
    }
    $('viewStatus').textContent='LOADING FRAMES';setUploadProgress('load',null,'Loading frames into the viewer');
    const out=await fetch(`/api/demos/${result.id}`);
    if(!out.ok)throw new Error('Could not load extracted replay');
    const data=await out.json();loadReplay(data,false);setUploadProgress('complete',100,'100%');
  }catch(error){$('demoUploadProgress').hidden=true;notify(error.message||'Unexpected error while parsing demo',true,10000);
    $('viewStatus').textContent=state.demo?'REPLAY READY':'NO DEMO LOADED';
    $('fileName').textContent=state.demo?.filename||'No file selected';
  }finally{state.busy=false;$('openDemo').disabled=false;$('fileInput').value='';
    if($('uploadStage').textContent==='Replay ready')setTimeout(()=>$('demoUploadProgress').hidden=true,1600);}
}

function createPreview(){
  const rounds=[],frames=[],players=[],kills=[],shots=[],loadouts=[],utility=[],blinds=[],damage_events=[],trajectories=[],bomb_events=[];
  const start=1000,roundLength=48*64,roundCount=12;
  const seeds=[[-1430,-800],[-1050,-1200],[-1600,-250],[-850,250],[-300,-700],[900,-190],[600,200],[1200,1000],[580,800],[1500,340]];
  const names=['notej','m0NESY','sh1ro','ropz','NiKo','donk','ZywOo','Twistzz','frozen','broky'];
  for(let i=0;i<10;i++){
    players.push({id:'preview_'+i,name:names[i]});
    const active=i%3===0?'weapon_awp':(i<5?'weapon_m4a1_silencer':'weapon_ak47');
    // Inventories are sampled per round below so the sample includes bomb transfers.
  }
  function approxPosition(pid,round,progress){
    const [x,y]=seeds[pid];const trend=progress*600;
    return [x+Math.sin(progress*5+pid*.8+round*.4)*175+(pid<5?trend:-trend),
      y+Math.cos(progress*4+pid*.9+round*.2)*170+(pid<5?trend*.35:-trend*.35),0];
  }
  for(let i=0;i<roundCount;i++){
    const s=start+i*roundLength;
    rounds.push({number:i+1,start:s,freeze:s+7*64,end:s+roundLength-6*64,
                 stop:s+roundLength-1,team_names:i<6?{'3':'SAMPLE TEAM ALPHA','2':'SAMPLE TEAM BRAVO'}:{'3':'SAMPLE TEAM BRAVO','2':'SAMPLE TEAM ALPHA'},winner:i%3===0?'CT':(i%3===1?'T':''),
                 win_type:i%4===0?'defuse':i%4===1?'explosion':i%3===2?'other':'elimination',round_seconds:115});
    const bomber=i<6?7:2;
    for(let k=0;k<10;k++){
      const ct=(k<5)===(i<6),gun=k%3===0?'weapon_awp':(ct?'weapon_m4a1_silencer':'weapon_ak47');
      loadouts.push({tick:s,player:k,active:gun,weapons:[gun,ct?'weapon_usp_silencer':'weapon_glock',
        'weapon_flashbang','weapon_smokegrenade',...(k%2===0?['weapon_hegrenade']:[]),
        ...(k===bomber?['weapon_c4']:[])],armor:100,helmet:k%3!==0,defuser:ct});
    }
    // One of the rounds shows a bomb hand-off in the sample.
    if(i===0){bomb_events.push({tick:s+15*64,round:i,type:'dropped',player:null,pos:approxPosition(bomber,i,15/48)});
      bomb_events.push({tick:s+19*64,round:i,type:'pickup',player:8});}
    if(i===1){
      bomb_events.push({tick:s+30*64,round:i,type:'planted',pos:[290,145,0]});
      bomb_events.push({tick:s+36*64,round:i,type:'defuse_start',player:0,has_kit:false});
      bomb_events.push({tick:s+38*64,round:i,type:'defuse_abort',player:0});
      bomb_events.push({tick:s+40*64,round:i,type:'defuse_start',player:1,has_kit:true});
      bomb_events.push({tick:s+45*64,round:i,type:'cleared'});
    }
    if(i===2){
      bomb_events.push({tick:s+29*64,round:i,type:'planted',pos:[-105,305,0]});
      bomb_events.push({tick:s+37*64,round:i,type:'defuse_start',player:0,has_kit:false});
    }
    for(const [j,[killer,victim,weapon]] of [[0,6,'ak47'],[7,1,'m4a1_silencer'],[2,8,'awp']].entries()){
      const tick=s+(24+j*7)*64;
      for(const dt of [-12,-7,-2,0])shots.push({tick:tick+dt,owner:killer,round:i,weapon,yaw:25+j*55, pos:approxPosition(killer,i,(24+j*7)/48)});
      kills.push({tick,round:i,killer,victim,assister:j===1?3:null,weapon,
                  flash_assist:j===1,headshot:j===2,wallbang:j===1,thrusmoke:j===0&&i%2===0,noscope:j===2&&i%3===0,
                  jumping:j===0&&i%4===0,attackerblind:j===2&&i%3===0,
                  killer_pos:approxPosition(killer,i,(24+j*7)/48),
                  victim_pos:approxPosition(victim,i,(24+j*7)/48)});
    }
    for(const [j,[type,owner,sec,location]] of [
      ['smoke',0,12,[120,220,0]],['flash',2,17,[-350,200,0]],
      ['he',6,21,[-300,-240,0]],['fire',7,26,[280,340,0]],
      ['decoy',3,31,[450,-220,0]]].entries()){
      const tick=s+sec*64,end=tick+({smoke:20,flash:.3,he:.6,fire:7,decoy:15}[type])*64;
      const pos=[location[0]+i*17,location[1]+i*11,0];
      const victims=type==='flash'?[{player:6,duration:2.6,tick:tick+2},{player:7,duration:1.3,tick:tick+2}]:
                    type==='he'?[{player:1,damage:41,tick:tick+3,pos:approxPosition(1,i,sec/48)}]:[];
      const damage=type==='he'?[{player:1,damage:41,armor_damage:5,tick:tick+3,pos:approxPosition(1,i,sec/48)}]:
                   type==='flash'?[{player:7,damage:1,armor_damage:0,tick:tick-8,pos:approxPosition(7,i,sec/48)}]:
                   type==='fire'?[{player:2,damage:10,armor_damage:0,tick:tick+64,pos:approxPosition(2,i,sec/48)},
                                  {player:2,damage:12,armor_damage:0,tick:tick+2*64,pos:approxPosition(2,i,sec/48)}]:[];
      if(type==='flash')victims.push({player:1,duration:1.8,tick:tick+3}); // teammate flash in sample
      const blinded=type==='flash'?victims:[];
      utility.push({type,start:tick,end,estimated_end:false,round:i,owner,entity:1000+i*10+j,pos,victims,damage,blinded});
      for(const v of damage)damage_events.push({tick:v.tick,attacker:owner,victim:v.player,damage:v.damage,armor_damage:v.armor_damage,weapon:type==='fire'?'inferno':type==='flash'?'flashbang':'hegrenade'});
      if(type==='flash')for(const v of victims)blinds.push({tick:v.tick,player:v.player,thrower:owner,enemy:true,duration:v.duration});

      const from=approxPosition(owner,i,(sec-3)/48);
      const points=[];
      for(let n=0;n<=12;n++){
        const q=n/12;
        points.push([tick-3*64+Math.round(3*64*q),from[0]+(pos[0]-from[0])*q,from[1]+(pos[1]-from[1])*q,120*Math.sin(Math.PI*q)]);
      }
      const id=trajectories.length;utility[utility.length-1].trajectory_id=id;
      trajectories.push({type,start:points[0][0],end:points.at(-1)[0],owner,points,estimated:false});
    }
    for(let j=0;j<48*8;j++){
      const t=s+j*8,progress=j/(48*8),pr=[];
      for(let k=0;k<10;k++){
        const team=(k<5)?(i<6?3:2):(i<6?2:3);
        const [x,y,z]=approxPosition(k,i,progress);
        const deaths=kills.filter(e=>e.victim===k&&e.tick<=t);
        const killedThisRound=deaths.some(e=>e.round===i);
        const dealt=damage_events.filter(e=>e.victim===k&&e.tick<=t&&e.tick>=s).reduce((sum,e)=>sum+e.damage,0);
        const hp=killedThisRound?0:Math.max(1,100-Math.floor(progress*(k%3)*22)-dealt);
        const K=kills.filter(e=>e.killer===k&&e.tick<=t).length;
        const D=deaths.length,A=kills.filter(e=>e.assister===k&&e.tick<=t).length;
        const UD=damage_events.filter(e=>e.attacker===k&&e.tick<=t).reduce((sum,e)=>sum+e.damage,0);
        const EF=blinds.filter(e=>e.thrower===k&&e.tick<=t).length;
        const flash=blinds.filter(e=>e.player===k&&e.tick<=t).map(e=>e.duration-(t-e.tick)/64).filter(x=>x>0);
        pr.push([k,x,y,z,team,k%5,hp,K,A,D,UD,EF,Math.max(0,4400-(i%4)*650-k*175),flash.length?Math.max(...flash):0,(j*2+k*33+i*7)%360-180]);
      }
      frames.push([t,pr]);
    }
  }
  // Explicitly fictional sample enemy health-damage events for ADR display.
  const enemy_damage_events=[...damage_events.filter(e=>e.attacker!=null&&e.victim!=null).map(e=>({tick:e.tick,attacker:e.attacker,victim:e.victim,damage:e.damage}))];
  for(const kill of kills)if(kill.killer!=null&&kill.victim!=null){
    enemy_damage_events.push({tick:kill.tick,attacker:kill.killer,victim:kill.victim,damage:100});
  }
  const bounds={x:[-2500,2500],y:[-2300,2300]};
  return {version:2,filename:'openreplay_sample.dem (simulated)',map:'de_mirage',tick_rate:64,
    sample_stride:8,start,end:frames.at(-1)[0],bounds,rounds,players,frames,kills,
    utility,blinds,damage_events,enemy_damage_events,trajectories,shots,loadouts,bomb_events,bomb_timer_seconds:40,
    available_stats:['kills_total','assists_total','deaths_total','utility_damage_total','enemies_flashed_total','balance','flash_duration'],
    limits:{sampling_ticks:8,area_estimates:true,adr_available:true}};
}

// Buttons + keyboard
function chooseFile(){$('fileInput').click();}
$('openDemo').addEventListener('click',chooseFile);
$('centerOpen').addEventListener('click',chooseFile);
$('trySample').addEventListener('click',()=>loadReplay(createPreview(),true));
$('fileInput').addEventListener('change',event=>uploadFile(event.target.files?.[0]));
$('playPause').addEventListener('click',()=>setPlayback(!state.playing));
$('previousRound').addEventListener('click',()=>jumpRound(-1));
$('nextRound').addEventListener('click',()=>jumpRound(1));
$('back5').addEventListener('click',()=>seek(state.tick-5*(state.demo?.tick_rate||64)));
$('forward5').addEventListener('click',()=>seek(state.tick+5*(state.demo?.tick_rate||64)));
mainSlider.addEventListener('input',()=>seek(Number(mainSlider.value)));
for(const btn of $('speedButtons').querySelectorAll('button')){
  btn.addEventListener('click',()=>{
    state.speed=Number(btn.dataset.speed);$('speedButtons').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===btn));
  });
}
$('toggleNames').addEventListener('click',()=>{
  state.showNames=!state.showNames;$('toggleNames').classList.toggle('active',state.showNames);
  $('toggleNames').setAttribute('aria-pressed',String(state.showNames));
  $('toggleNames span').textContent=state.showNames?'Names on':'Names off';
});
$('toggleGrid').addEventListener('click',()=>{
  state.showGrid=!state.showGrid;$('toggleGrid').classList.toggle('active',state.showGrid);
  $('toggleGrid').setAttribute('aria-pressed',String(state.showGrid));
});
$('toggleLevel').addEventListener('click',()=>{
  if(!state.lowerImage){notify('Lower map image is still loading or unavailable.');return;}
  state.floorView=state.floorView==='stacked'?'layered':'stacked';
  document.querySelector('#toggleLevel span').textContent=state.floorView==='stacked'?'Stacked':'Layered';
  $('toggleLevel').classList.toggle('active',state.floorView==='layered');
  $('toggleLevel').setAttribute('aria-pressed',String(state.floorView==='layered'));
  $('levelBadge').textContent=state.floorView==='stacked'?'UPPER / LOWER':state.layeredFloor.toUpperCase()+' LEVEL';
  updateFloorButtons();resetView();
});
for(const floor of ['upper','lower'])$('layerFloor'+floor[0].toUpperCase()+floor.slice(1)).addEventListener('click',()=>{state.layeredFloor=floor;updateFloorButtons();$('levelBadge').textContent=floor.toUpperCase()+' LEVEL';});
$('helpButton').addEventListener('click',()=>$('helpDialog').showModal());
$('closeHelp').addEventListener('click',()=>$('helpDialog').close());
$('helpDone').addEventListener('click',()=>$('helpDialog').close());
document.addEventListener('keydown',event=>{
  if(event.target.matches('input,textarea,select,[contenteditable]')||event.metaKey||event.altKey||$('helpDialog').open)return;
  if(event.code==='Backspace'&&!event.ctrlKey){
    if(!state.demo)return;
    event.preventDefault();
    state.radarStrokes=[];
    notify('Radar annotations erased.',false,2200);
    return;
  }
  if(event.ctrlKey)return;
  if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code))event.preventDefault();
  if(event.code==='Space')setPlayback(!state.playing);
  else if(event.code==='ArrowLeft')seek(state.tick-5*(state.demo?.tick_rate||64));
  else if(event.code==='ArrowRight')seek(state.tick+5*(state.demo?.tick_rate||64));
  else if(event.code==='ArrowUp')jumpRound(-1);
  else if(event.code==='ArrowDown')jumpRound(1);
});
let dragDepth=0;
document.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;$('dropOverlay').hidden=false;});
document.addEventListener('dragover',e=>{e.preventDefault();});
document.addEventListener('dragleave',e=>{e.preventDefault();dragDepth--;if(dragDepth<=0){dragDepth=0;$('dropOverlay').hidden=true;}});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;uploadFile(e.dataTransfer?.files?.[0]);});
canvas.addEventListener('mousemove',e=>{
  const raw=canvasPoint(e), p=inverseCamera(raw.x,raw.y), x=p.x,y=p.y;
  if(state.map?.calibrated&&state.image){
    const lower=isStacked()&&y>=LOWER_ORIGIN;const cy=lower?y-LOWER_ORIGIN:y;
    $('coords').textContent=`${Math.round(state.map.pos_x+x*state.map.scale)}, ${Math.round(state.map.pos_y-cy*state.map.scale)}${isStacked()?' · '+(lower?'LOWER':'UPPER'):''}`;
  }else if(state.demo){
    const b=state.demo.bounds;
    const wx=b.x[0]+(x-64)*(b.x[1]-b.x[0])/896;
    const wy=b.y[0]+(960-y)*(b.y[1]-b.y[0])/896;
    $('coords').textContent=`${Math.round(wx)}, ${Math.round(wy)}`;
  }
});
$('viewerRound').addEventListener('change',()=>{
  if(state.demo)seek(state.demo.rounds[Number($('viewerRound').value)]?.start??state.tick);
});
$('clearUtilityPlayers').addEventListener('click',()=>{state.utilityPlayers.clear();$('utilityPlayerOptions').querySelectorAll('input').forEach(el=>el.checked=false);refreshUtilityPlayers();});
$('eventPlayer').addEventListener('change',()=>{
  state.eventPlayer=$('eventPlayer').value;state.selectedKill=-1;state.selectedUtility=-1;
  refreshEvents();refreshPlayers(rosterAt(state.tick));
});
// Preserve the event dock dimensions. Scroll wide event strips without a space-hungry scrollbar.
$('eventList').addEventListener('wheel',event=>{
  const strip=$('eventList');
  if(strip.scrollWidth<=strip.clientWidth)return;
  if(Math.abs(event.deltaY)>Math.abs(event.deltaX)){
    strip.scrollLeft+=event.deltaY;
    event.preventDefault();
  }
},{passive:false});
const utilityTypePicker=$('utilityTypePicker');
function refreshUtilityTypeFilter(){
  const count=state.selectedUtilityTypes.size;
  $('utilityTypeSummary').textContent=count===5?'All':`${count}/5`;
  $('utilityTotal').textContent=roundUtility().length;
  refreshEvents();refreshActiveUtility();buildTimelineEvents();
}
utilityTypePicker.querySelectorAll('input[type="checkbox"]').forEach(input=>input.addEventListener('change',()=>{
  if(input.checked)state.selectedUtilityTypes.add(input.value);else state.selectedUtilityTypes.delete(input.value);
  refreshUtilityTypeFilter();
}));
$('allUtilityTypes').addEventListener('click',()=>{
  state.selectedUtilityTypes=new Set(['smoke','flash','he','fire','decoy']);
  utilityTypePicker.querySelectorAll('input').forEach(input=>input.checked=true);
  refreshUtilityTypeFilter();
});
document.addEventListener('pointerdown',event=>{if(utilityTypePicker.open&&!utilityTypePicker.contains(event.target))utilityTypePicker.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&utilityTypePicker.open)utilityTypePicker.open=false;});
document.addEventListener('pointerdown',event=>{const p=$('utilityPlayerPicker');if(p.open&&!p.contains(event.target))p.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('utilityPlayerPicker').open)$('utilityPlayerPicker').open=false;});
for(const [name,tab] of [['killTab','kills'],['utilTab','utility']]){
  $(name).addEventListener('click',()=>{
    state.eventTab=tab;hideUtilityBreakdown();utilityTypePicker.hidden=tab!=='utility';$('utilityPlayerPicker').hidden=tab!=='utility';$('eventPlayer').hidden=tab==='utility';$('eventPlayerLabel').hidden=tab==='utility';if(tab!=='utility'){utilityTypePicker.open=false;$('utilityPlayerPicker').open=false;}
    $('killTab').classList.toggle('chosen',tab==='kills');
    $('utilTab').classList.toggle('chosen',tab==='utility');refreshEvents();
  });
}
for(const [id,key] of [['toggleUtility','showUtility'],['toggleDeaths','showDeaths']]){
  $(id).addEventListener('click',()=>{
    state[key]=!state[key];state.lastPaintTime=0;$(id).classList.toggle('active',state[key]);
    $(id).setAttribute('aria-pressed',String(state[key]));
    if(key==='showUtility')refreshActiveUtility();
  });
}
// The tactical focus layout is now the normal page. The native fullscreen toggle
// has been removed; zoom and drag controls only affect the map canvas.
$('clearPlayerFilter').addEventListener('click',()=>{state.selectedPlayers.clear();updatePlayerFilter();});
// Native <details> preserves summary click-to-toggle and keyboard accessibility.
// Close it when the user interacts anywhere outside, including the map and timeline.
const timelinePicker=$('timelinePlayerPicker');
document.addEventListener('pointerdown',event=>{
  if(timelinePicker.open&&!timelinePicker.contains(event.target))timelinePicker.open=false;
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&timelinePicker.open){timelinePicker.open=false;timelinePicker.querySelector('summary').focus();}
});
$('clearTimelinePlayers').addEventListener('click',()=>{
  state.timelinePlayers.clear();
  $('timelinePlayerOptions').querySelectorAll('input[type=checkbox]').forEach(x=>x.checked=false);
  updateTimelinePlayerFilter();
});
$('timelineFullMatch').addEventListener('click',()=>setTimelineScope('match'));
$('timelineCurrentRound').addEventListener('click',()=>setTimelineScope('round'));
for(const button of document.querySelectorAll('.score-sort-btn'))button.addEventListener('click',()=>setScoreSort(button.dataset.sort));
$('timelineZoomIn').addEventListener('click',()=>zoomTimeline(.5,(state.timelineStart+state.timelineEnd)/2));
$('timelineZoomOut').addEventListener('click',()=>zoomTimeline(2,(state.timelineStart+state.timelineEnd)/2));
$('timelineReset').addEventListener('click',resetTimeline);
$('timelinePanBack').addEventListener('click',()=>panTimeline(-.55));
$('timelinePanForward').addEventListener('click',()=>panTimeline(.55));
const timelineTrack=$('timelineTrack');
timelineTrack.addEventListener('wheel',e=>{
  if(!state.demo)return;e.preventDefault();
  if(e.shiftKey){panTimeline(Math.sign(e.deltaY)*.20);return;}
  const r=timelineTrack.getBoundingClientRect(),f=clamp((e.clientX-r.left)/r.width,0,1);
  zoomTimeline(Math.exp(e.deltaY*.0025),state.timelineStart+timelineWindowSize()*f);
},{passive:false});
const overviewTrack=$('timelineOverview');
overviewTrack.addEventListener('pointerdown',e=>{
  if(!state.demo||e.button!==0)return;
  const r=overviewTrack.getBoundingClientRect(),f=clamp((e.clientX-r.left)/r.width,0,1);
  const tick=state.demo.start+f*(state.demo.end-state.demo.start);
  overviewTrack.setPointerCapture(e.pointerId);
  state.overviewDrag={id:e.pointerId,oldX:e.clientX,moved:false};
  setTimelineWindow(tick-timelineWindowSize()/2,tick+timelineWindowSize()/2);
});
overviewTrack.addEventListener('pointermove',e=>{
  if(!state.overviewDrag||state.overviewDrag.id!==e.pointerId)return;
  const r=overviewTrack.getBoundingClientRect();
  const amount=(e.clientX-state.overviewDrag.oldX)/r.width*(state.demo.end-state.demo.start);
  state.overviewDrag.oldX=e.clientX;state.overviewDrag.moved=true;
  setTimelineWindow(state.timelineStart+amount,state.timelineEnd+amount);
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])overviewTrack.addEventListener(event,()=>{state.overviewDrag=null;});

$('zoomIn').addEventListener('click',()=>changeZoom(1.3));
$('zoomOut').addEventListener('click',()=>changeZoom(1/1.3));
$('resetView').addEventListener('click',resetView);
canvas.addEventListener('wheel',event=>{if(!state.demo)return;event.preventDefault();const p=canvasPoint(event);changeZoom(Math.exp(-event.deltaY*.0013),p.x,p.y);},{passive:false});
canvas.addEventListener('pointerdown',event=>{
  if(!state.demo||event.button!==0)return;
  const here=canvasPoint(event);
  const mode=event.shiftKey?'select':event.ctrlKey?'draw':'pan';
  canvas.setPointerCapture(event.pointerId);
  state.dragPointer={id:event.pointerId,mode,startX:here.x,startY:here.y,
                     x:here.x,y:here.y,clientX:event.clientX,clientY:event.clientY};
  canvas.classList.toggle('dragging',mode==='pan');
  canvas.classList.toggle('selecting',mode==='select');
  canvas.classList.toggle('drawing',mode==='draw');
  if(mode==='draw'){
    const p=inverseCamera(here.x,here.y);
    const stroke=[p];state.radarStrokes.push(stroke);state.dragPointer.stroke=stroke;
  }
  event.preventDefault();
});
canvas.addEventListener('pointermove',event=>{
  const drag=state.dragPointer;
  if(!drag||drag.id!==event.pointerId)return;
  const here=canvasPoint(event);
  if(drag.mode==='pan'){
    state.panX+=(event.clientX-drag.clientX)/baseScale();
    state.panY+=(event.clientY-drag.clientY)/baseScale();
    drag.clientX=event.clientX;drag.clientY=event.clientY;
  }else if(drag.mode==='draw'){
    const point=inverseCamera(here.x,here.y);
    const last=drag.stroke.at(-1);
    if(Math.hypot(point.x-last.x,point.y-last.y)>.7/(baseScale()*state.zoom))drag.stroke.push(point);
  }
  drag.x=here.x;drag.y=here.y;
});
function endMapDrag(event,cancelled=false){
  const drag=state.dragPointer;
  if(!drag||drag.id!==event.pointerId)return;
  if(drag.mode==='select'&&!cancelled){
    const end=canvasPoint(event);
    commitRadarSelection(drag.startX,drag.startY,end.x,end.y);
  }
  state.dragPointer=null;
  canvas.classList.remove('dragging','selecting','drawing');
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup',event=>endMapDrag(event));
canvas.addEventListener('pointercancel',event=>endMapDrag(event,true));
new ResizeObserver(resizeRadar).observe($('radarWrap'));
canvas.addEventListener('lostpointercapture',()=>{
  state.dragPointer=null;canvas.classList.remove('dragging','selecting','drawing');
});
requestAnimationFrame(animate);

// Floating utility impact details do not change the dock's fixed height.
document.addEventListener('pointerdown',event=>{
  const detail=$('utilityDetail');
  if(detail&&!detail.hidden&&!detail.contains(event.target)&&!event.target.closest('.utility-card'))hideUtilityBreakdown();
});
