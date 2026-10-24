"""Parse Counter-Strike 2 demo positions, kills, stats and grenade events for OpenReplay."""
from __future__ import annotations

import math
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

SAMPLE_EVERY_TICKS = 8
TICK_RATE = 64.0
CORE_PROPS = ['X', 'Y', 'Z', 'team_num', 'player_color', 'health', 'is_alive']
VIEW_PROPS = ['yaw','active_weapon_name','inventory','armor','has_helmet','has_defuser']
STAT_PROPS = ['kills_total','assists_total','deaths_total', 'utility_damage_total',
              'enemies_flashed_total','balance','flash_duration']
UTILITY_TYPES = {
    'flashbang_detonate': 'flash', 'smokegrenade_detonate': 'smoke',
    'hegrenade_detonate': 'he', 'inferno_startburn': 'fire',
    'molotov_detonate': 'fire', 'incgrenade_detonate': 'fire', 'decoy_started': 'decoy',
    'decoy_detonate': 'decoy',
}
END_EVENTS = {'smoke':'smokegrenade_expired','fire':'inferno_expire','decoy':'decoy_stopped'}
ESTIMATED_SECONDS = {'smoke':20, 'fire':7, 'decoy':15, 'flash':.3, 'he':.6}


def _integer(value, default=None):
    try:
        if value is None or isinstance(value, float) and not math.isfinite(value):
            return default
        return int(value)
    except (ValueError, TypeError, OverflowError):
        return default


def _number(value, default=None):
    try:
        n=float(value)
        return n if math.isfinite(n) else default
    except (ValueError, TypeError, OverflowError):
        return default


def _records(df):
    if df is None or getattr(df,'empty',True):
        return []
    return sorted((r for r in df.to_dict('records') if _integer(r.get('tick')) is not None),
                  key=lambda r:int(r['tick']))


def _events(parser, event, with_positions=False):
    """Optional event support must never prevent a replay from loading."""
    try:
        if with_positions:
            try:
                return _records(parser.parse_event(event,player=['X','Y','Z','flash_duration']))
            except Exception:
                try:
                    return _records(parser.parse_event(event,player=['X','Y','Z']))
                except Exception:
                    pass
        return _records(parser.parse_event(event))
    except Exception:
        return []


def _event_id(row, prefix, player_index):
    steamid = _integer(row.get(prefix+'_steamid'), 0)
    if steamid:
        return player_index.get(str(steamid))
    name = str(row.get(prefix+'_name') or '').lower()
    if name:
        for sid,ix in player_index.items():
            if sid.startswith('bot:') and sid[4:].lower() == name:
                return ix
    return None


def _position(row, prefix=''):
    # The game event may contain its own x/y or extra player actor coordinates.
    for fields in ((prefix+'X',prefix+'Y',prefix+'Z'),(prefix+'x',prefix+'y',prefix+'z')):
        x,y = _number(row.get(fields[0])), _number(row.get(fields[1]))
        if x is not None and y is not None:
            return [round(x,1),round(y,1),round(_number(row.get(fields[2]),0),1)]
    return None


def _event_entity(row):
    for key in ('entityid','entity_id','entindex','entity_index','grenade_entity_id'):
        n=_integer(row.get(key))
        if n is not None:
            return n
    return None


def _event_actors(event, player_index):
    return (_event_id(event,'user',player_index),_event_id(event,'attacker',player_index))


def _flag(value):
    # Some parser builds export game flags as numpy booleans or 0/1 values.
    if isinstance(value, str):
        return value.strip().lower() in ('true', '1', 'yes')
    return value is not None and bool(value) and not (isinstance(value, float) and math.isnan(value))


def _first_flag(row, *names):
    return any(_flag(row.get(key)) for key in names)


def trim_stationary_tail(points, threshold=2.5, min_ticks=12):
    """Drop persistent post-landing grenade samples, preserving touchdown."""
    if len(points) < 4:
        return points
    last = points[-1]
    first_still = len(points)-1
    while first_still > 0 and math.dist(points[first_still-1][1:4], last[1:4]) <= threshold:
        first_still -= 1
    if first_still and len(points)-first_still >= 3 and last[0]-points[first_still][0] >= min_ticks:
        return points[:first_still+1]
    return points


def _round_index(rounds, tick):
    ix=bisect_right([r['start'] for r in rounds],tick)-1
    if ix<0 or tick>rounds[ix]['stop']:
        return -1
    return ix


def build_kills(events, rounds, player_index):
    result=[]
    for row in events:
        tick=_integer(row.get('tick'))
        if tick is None:continue
        ri=_round_index(rounds,tick)
        if ri<0:continue
        victim=_event_id(row,'user',player_index)
        if victim is None:
            victim=_event_id(row,'victim',player_index)
        killer=_event_id(row,'attacker',player_index)
        assister=_event_id(row,'assister',player_index)
        result.append({'tick':tick,'round':ri,'killer':killer,'victim':victim,
                       'assister':assister, 'flash_assist':assister is not None and _first_flag(row,'assistedflash','assisted_flash'), 'weapon':str(row.get('weapon') or 'unknown'),
                       'headshot':_first_flag(row,'headshot'),
                       'wallbang':(_integer(row.get('penetrated'),0) or 0)>0 or _first_flag(row,'wallbang'),
                       'thrusmoke':_first_flag(row,'thrusmoke','throughsmoke'),
                       'dominated':_first_flag(row,'dominated'), 'revenge':_first_flag(row,'revenge'),
                       'noscope':_first_flag(row,'noscope','no_scope'),
                       'attackerblind':_first_flag(row,'attackerblind','attacker_blind'),
                       'jumping':_first_flag(row,'attackerinair','attacker_in_air','attacker_is_airborne','attackerjumping'),
                       'suicide':killer is not None and killer==victim,
                       'killer_pos':_position(row,'attacker_'),
                       'victim_pos':_position(row,'user_') or _position(row,'victim_')})
    return result


def _impact_victims(hurt_events, player_index, tick, kind, attacker=None):
    results=[]
    for r in hurt_events:
        rt=_integer(r.get('tick'))
        if rt is None or abs(rt-tick)>8:continue
        weapon=str(r.get('weapon') or '').lower()
        is_he=('hegrenade' in weapon or 'he_grenade' in weapon)
        is_fire=('inferno' in weapon or 'molotov' in weapon or 'incgrenade' in weapon)
        if kind=='he' and not is_he:continue
        if kind=='fire' and not is_fire:continue
        if kind not in ('he','fire'):continue
        if attacker is not None and _event_id(r,'attacker',player_index)!=attacker:continue
        dmg=_integer(r.get('dmg_health'), _integer(r.get('damage'),None))
        if dmg is not None and dmg>0:
            results.append({'player':_event_id(r,'user',player_index),'damage':dmg,
                            'tick':rt,'pos':_position(r,'user_')})
    return results


def build_utility(events_by_type, rounds, player_index, hurt_events=None, blinds=None):
    """Prefer actual start/end events; estimated lifecycle is explicitly flagged."""
    hurt_events=hurt_events or []
    blinds=blinds or []
    starts=[]
    for evtype,kind in UTILITY_TYPES.items():
        for row in events_by_type.get(evtype,[]):
            tick=_integer(row.get('tick'))
            if tick is None:continue
            ri=_round_index(rounds,tick)
            if ri<0:continue
            owner=_event_id(row,'user',player_index)
            if owner is None:owner=_event_id(row,'attacker',player_index)
            pos=_position(row) or _position(row,'user_')
            # Inferno and molotov events sometimes describe the same activation.
            if kind=='fire' and any(s['type']=='fire' and abs(s['start']-tick)<=8
                    and ((s['entity'] is not None and s['entity'] == _event_entity(row)) or (pos and s['pos'] and
                    math.dist(pos[:2],s['pos'][:2])<50)) for s in starts):
                continue
            if kind=='decoy' and any(s['type']=='decoy' and abs(s['start']-tick)<=8
                    and ((s['entity'] is not None and s['entity']==_event_entity(row)) or (pos and s['pos'] and math.dist(pos[:2],s['pos'][:2])<50)) for s in starts):
                continue
            starts.append({'type':kind,'start':tick,'end':tick+round(ESTIMATED_SECONDS[kind]*TICK_RATE),
                           'estimated_end':True,'round':ri,'owner':owner,
                           'entity':_event_entity(row),'pos':pos,'victims':[]})
    starts.sort(key=lambda s:s['start'])
    for item in starts:
        event_name=END_EVENTS.get(item['type'])
        if not event_name:continue
        candidates=[]
        for r in events_by_type.get(event_name,[]):
            end=_integer(r.get('tick'))
            if end is None or end < item['start'] or end > item['start']+45*TICK_RATE:continue
            if item['entity'] is not None and _event_entity(r) is not None:
                if item['entity'] != _event_entity(r):continue
                score=0
            else:
                endpos=_position(r)
                score=math.dist(item['pos'][:2],endpos[:2]) if item['pos'] and endpos else 500
            candidates.append((score,end))
        if candidates:
            score,stop=min(candidates)
            if score <= 500:
                item['end']=stop;item['estimated_end']=False
    # Associate HE victims with exact hurt events, flash blind events with flash events.
    for item in starts:
        if item['type']=='he':
            item['victims']=_impact_victims(hurt_events,player_index,item['start'],'he',item['owner'])
        elif item['type']=='flash':
            item['victims']=[{'player':b['player'],'duration':b['duration'],'tick':b['tick']}
                for b in blinds if b['player'] is not None and 0<=b['tick']-item['start']<=64
                and (item['owner'] is None or b['thrower'] is None or item['owner']==b['thrower'])]
        elif item['type']=='fire':
            item['victims']=_impact_victims(hurt_events,player_index,item['start'],'fire',item['owner'])
    return starts



def build_shots(events, rounds, player_index, frames):
    """Individual bullet-firing events; do not treat thrown grenades as gunshots."""
    ticks=[frame[0] for frame in frames]
    result=[]
    for row in events:
        tick=_integer(row.get('tick'))
        if tick is None or _round_index(rounds,tick)<0:continue
        weapon=str(row.get('weapon') or '').lower()
        if any(x in weapon for x in ('flash','smoke','grenade','molotov','incendiary','decoy','knife','c4','taser')):
            continue
        owner=_event_id(row,'user',player_index)
        if owner is None:owner=_event_id(row,'player',player_index)
        if owner is None:continue
        i=max(0,bisect_right(ticks,tick)-1)
        frame=frames[i][1]
        entry=next((p for p in frame if p[0]==owner),None)
        yaw=_number(row.get('user_yaw'), _number(row.get('user_yaw_angle')))
        if yaw is None and entry and len(entry)>14:yaw=_number(entry[14])
        pos=_position(row,'user_')
        if pos is None and entry:pos=entry[1:4]
        result.append({'tick':tick,'owner':owner,'round':_round_index(rounds,tick),
                       'weapon':weapon,'yaw':yaw,'pos':pos})
    return result


def build_bomb_events(events, rounds, player_index, frames=None):
    """Recorded C4 ownership, planting and defusal state changes.

    The `haskit` flag comes from `bomb_begindefuse`, not a guess from
    which team is defusing. When event positions are missing, a nearby
    sampled actor position is used ONLY to locate a dropped/planted C4.
    """
    mapping = {'player_given_c4': 'pickup', 'bomb_pickup': 'pickup', 'bomb_dropped': 'dropped',
               'bomb_planted': 'planted', 'bomb_defused': 'cleared',
               'bomb_exploded': 'cleared', 'bomb_begindefuse': 'defuse_start',
               'bomb_abortdefuse': 'defuse_abort'}
    result = []
    frame_ticks = [f[0] for f in frames] if frames else None
    for event, kind in mapping.items():
        for row in events.get(event, []):
            tick = _integer(row.get('tick'))
            if tick is None:
                continue
            ri = _round_index(rounds, tick)
            if ri < 0:
                continue
            player = _event_id(row, 'user', player_index)
            if player is None:
                player = _event_id(row, 'player', player_index)
            pos = None
            if kind in ('dropped', 'planted'):
                pos = _position(row) or _position(row, 'bomb_')
                if pos is None and player is not None:
                    pos = _position(row, 'user_')
                if pos is None and player is not None and frames:
                    pos = actor_position_at(frames, tick, player, frame_ticks)
            item = {'tick': tick, 'round': ri, 'type': kind,
                    'player': player if kind in ('pickup', 'defuse_start', 'defuse_abort') else None,
                    'pos': pos, 'source': 'event'}
            if kind == 'defuse_start':
                raw = row.get('haskit', row.get('has_kit'))
                item['has_kit'] = _flag(raw) if raw is not None else None
            if event in ('bomb_defused', 'bomb_exploded'):
                item['outcome'] = 'defuse' if event == 'bomb_defused' else 'explosion'
            result.append(item)
    # Stable chronological ordering is critical for aborted/restarted defuses.
    return sorted(result, key=lambda e: e['tick'])


def actor_position_at(frames, tick, player, frame_ticks=None):
    """Interpolate the actor at the event tick (never borrow an unrelated player's position)."""
    if player is None or not frames:
        return None
    if frame_ticks is None:
        frame_ticks = [f[0] for f in frames]
    ix = bisect_right(frame_ticks, tick)
    before = frames[ix - 1] if ix else None
    after = frames[ix] if ix < len(frames) else None
    def actor(frame):
        return next((p for p in frame[1] if p[0] == player), None) if frame else None
    a, b = actor(before), actor(after)
    if a and b and 0 < after[0] - before[0] <= SAMPLE_EVERY_TICKS * 3:
        fraction = max(0, min(1, (tick - before[0]) / (after[0] - before[0])))
        return [round(a[k] + (b[k] - a[k]) * fraction, 1) for k in (1, 2, 3)]
    if a and tick - before[0] <= SAMPLE_EVERY_TICKS * 3:
        return a[1:4]
    if b and after[0] - tick <= SAMPLE_EVERY_TICKS * 3:
        return b[1:4]
    return None


def infer_bomb_inventory_events(loadouts, rounds, recorded_events, frames):
    """Fill missing bomb ownership changes from observed C4 inventory transitions.

    Events are primary. All player inventories at the *same tick* are handled
    together so a handoff never ends as a drop because of iteration order.
    """
    def carries(item):
        weapons = item.get('weapons')
        if not isinstance(weapons, (list, tuple)):
            return None
        return any(str(w).lower().replace('weapon_', '') in ('c4', 'bomb') for w in weapons)
    generated = []
    frame_ticks = [f[0] for f in frames] if frames else None
    for ri, round_ in enumerate(rounds):
        updates = [item for item in loadouts if round_['start'] <= item['tick'] <= round_['stop']]
        updates.sort(key=lambda x: x['tick'])
        has = {}
        owner = None
        offset = 0
        while offset < len(updates):
            tick = updates[offset]['tick']
            at_tick = []
            while offset < len(updates) and updates[offset]['tick'] == tick:
                at_tick.append(updates[offset]);offset += 1
            became_carrier = []
            for item in at_tick:
                pid,now=item['player'],carries(item)
                if now is None:continue
                if now and not has.get(pid,False):became_carrier.append(pid)
                has[pid] = now
            if owner is not None and not has.get(owner,False):
                next_owner=became_carrier[-1] if became_carrier else None
            elif became_carrier:
                next_owner=became_carrier[-1]
            else:
                next_owner=owner
            if owner == next_owner:continue
            # Do not let a delayed inventory sample overwrite a recorded plant,
            # defuse or explosion; these are terminal ownership states.
            if any(e['round']==ri and e['type'] in ('planted','cleared') and e['tick']<=tick
                   for e in recorded_events):
                owner=next_owner
                continue
            around=[e for e in recorded_events if e['round']==ri and
                    abs(e['tick']-tick)<=64 and
                    e['type'] in ('pickup','dropped','planted','cleared')]
            if not around:
                typ='pickup' if next_owner is not None else 'dropped'
                generated.append({'tick':tick,'round':ri,'type':typ,
                                  'player':next_owner,
                                  'pos':actor_position_at(frames,tick,owner,frame_ticks) if next_owner is None else None,
                                  'source':'inventory'})
            owner=next_owner
    return sorted(recorded_events+generated,
                  key=lambda e:(e['tick'],0 if e.get('source')=='inventory' else 1))


def _inventory_items(raw):
    """Normalize optional inventory values without interpreting a missing inventory as empty."""
    if raw is None:return None
    if hasattr(raw,'tolist') and not isinstance(raw,(str,bytes)):
        try:raw=raw.tolist()
        except Exception:pass
    if isinstance(raw,(list,tuple,set)):
        values=sorted(str(item).strip() for item in raw if str(item).strip() and str(item).lower()!='nan')
        # CS2 permits two flashes but not two identical primary guns. Some
        # parser builds report the same held weapon more than once.
        normalized=[]
        for value in values:
            limit=2 if value.lower() in ('weapon_flashbang','flashbang') else 1
            if normalized.count(value)<limit:normalized.append(value)
        return normalized
    if isinstance(raw,str):
        value=raw.strip()
        if not value or value.lower() in ('none','nan','null'):return None
        try:
            import ast
            parsed=ast.literal_eval(value)
            if isinstance(parsed,(list,tuple,set)):return _inventory_items(parsed)
        except (ValueError,SyntaxError):pass
        if ',' in value:return _inventory_items([part.strip(' []\"\'') for part in value.split(',')])
        return [value]
    return None


def build_blinds(events, player_index, frames, frame_ticks):
    result=[]
    for row in events:
        tick=_integer(row.get('tick'))
        if tick is None:continue
        victim=_event_id(row,'user',player_index)
        thrower=_event_id(row,'attacker',player_index)
        # The event's `blind_duration` is the measured applied blind. The
        # player property at this tick may still be zero or stale.
        duration=_number(row.get('blind_duration'))
        if duration is None or duration <= 0:
            duration=_number(row.get('user_flash_duration'))
        if (duration is None or duration <= 0) and victim is not None:
            i=bisect_right(frame_ticks,tick)
            # Read measured flash duration from the next couple of sampled ticks,
            # rather than inventing one for an unrecorded victim.
            for frame in frames[i:i+3]:
                if frame[0]>tick+24:break
                entry=next((p for p in frame[1] if p[0]==victim),None)
                if entry is not None and len(entry)>13:
                    d=_number(entry[13])
                    if d is not None and d>0:
                        duration=round(d,2);break
        def side(pid):
            if pid is None:return None
            candidate=frames[max(0,min(len(frames)-1,bisect_right(frame_ticks,tick)-1))]
            p=next((entry for entry in candidate[1] if entry[0]==pid),None)
            return p[4] if p else None
        enemy=side(victim)!=side(thrower) if side(victim) in (2,3) and side(thrower) in (2,3) else None
        result.append({'tick':tick,'player':victim,'thrower':thrower,'enemy':enemy,
                       'entity':_event_entity(row),
                       'duration' :round(duration,2) if duration is not None and duration>=0 else None})
    return result


def parse_trajectory(parser, utility, player_index, start_tick, end_tick, players=None):
    """Thin grenade entity sample points. Data may be absent in some demo formats."""
    try:
        raw=parser.parse_grenades()
        if raw is None or raw.empty:return []
        cols=set(raw.columns)
        if not {'tick','X','Y'}<=cols and not {'tick','x','y'}<=cols:return []
        tracks=defaultdict(list)
        for r in raw.to_dict('records'):
            t=_integer(r.get('tick'))
            if t is None or t<start_tick or t>end_tick:continue
            ent=_event_entity(r)
            if ent is None:continue
            pos=_position(r)
            if pos is None:continue
            tracks[ent].append((t,pos,r))
        types={'smokegrenade':'smoke','flashbang':'flash','hegrenade':'he',
               'molotov':'fire','incendiarygrenade':'fire','incgrenade':'fire','decoygrenade':'decoy',
               'flash':'flash','smoke':'smoke','decoy':'decoy','inferno':'fire'}
        trajectories=[]
        by_name=defaultdict(set)
        for i,pl in enumerate(players or []):
            name=str(pl.get('name','')).strip().lower()
            if name:by_name[name].add(i)
        def resolve_owner(row):
            for key in ('thrower_steamid','steamid','user_steamid'):
                steamid=_integer(row.get(key))
                if steamid is None:continue
                direct=player_index.get(str(steamid))
                if direct is not None:return direct
            name=str(row.get('thrower_name') or row.get('name') or '').strip().lower()
            if len(by_name[name])==1:return next(iter(by_name[name]))
            # pandas may promote a nullable SteamID to float64, rounding
            # 17-digit IDs. Only accept a fuzzy match if it is unambiguous.
            for key in ('thrower_steamid','steamid','user_steamid'):
                num=_integer(row.get(key))
                if num is None:continue
                matches={ix for sid,ix in player_index.items()
                         if sid.isdigit() and abs(int(sid)-num)<=32}
                if len(matches)==1:return next(iter(matches))
            return None
        for entity,observations in tracks.items():
            # Entity IDs can be reused later in the match; never connect two
            # unrelated grenade flights into one impossible long throw.
            observations.sort(key=lambda item:item[0])
            segments=[];current=[];last_tick=None
            for entry in observations:
                if current and last_tick is not None and entry[0]-last_tick>192:
                    segments.append(current);current=[]
                current.append(entry);last_tick=entry[0]
            if current:segments.append(current)
            for segment in segments:
                if len(segment)<2:continue
                grenade_type=next((str(r.get('grenade_type') or r.get('weapon') or r.get('type'))
                    for _,_,r in segment if (r.get('grenade_type') or r.get('weapon') or r.get('type')) is not None),'').lower().replace('_','')
                kind=next((name for key,name in types.items() if key in grenade_type),'unknown')
                if kind=='unknown':continue
                # A grenade's first sampled tick may not have a thrower ID yet.
                # Find a usable Steam ID anywhere during its recorded flight.
                owner=None
                for _,_,r in segment:
                    owner=resolve_owner(r)
                    if owner is not None:break
                points=[]
                for t,pos,_ in segment:
                    if not points or t>points[-1][0]:points.append([t,*pos])
                # Some grenade entities remain static in parse_grenades until
                # smoke expiry; only preserve the actual traveling projectile.
                points=trim_stationary_tail(points)
                sampled=points[::max(1,len(points)//170)]
                if len(sampled)>1 and sampled[-1]!=points[-1]:sampled.append(points[-1])
                if len(sampled)<2:continue
                trajectories.append({'type':kind,'start':sampled[0][0],'end':sampled[-1][0],
                                     'owner':owner,'entity':entity,'points':sampled,'estimated':False})
        return trajectories[:1000]
    except Exception:
        return []

def enrich_utility_with_trajectories(utilities, trajectories, rounds):
    """Attach missing event coordinates or produce flagged inferred endpoint effects.

    Event ticks/positions are authoritative; projectile endpoints only help when
    CS2 recordings omit the game event / x,y fields. Never call an inferred
    projectile endpoint an exact detonation.
    """
    used=set()
    for util in utilities:
        candidates=[]
        for i,tr in enumerate(trajectories):
            if i in used or tr['type']!=util['type'] or not tr['points']:
                continue
            last=tr['points'][-1]
            dt=abs(last[0]-util['start'])
            entity_matches=util.get('entity') is not None and tr.get('entity')==util['entity']
            if dt>128 and not entity_matches:continue
            if util.get('entity') is not None and tr.get('entity') is not None and not entity_matches:continue
            distance=0
            if util['pos']:
                distance=math.dist(util['pos'][:2],last[1:3])
                if distance>260:continue
            owner_mismatch=util['owner'] is not None and tr['owner'] is not None and util['owner']!=tr['owner']
            if owner_mismatch:continue
            candidates.append((dt+distance/10,i,tr))
        if not candidates:continue
        _,ix,tr=min(candidates,key=lambda c:c[0]);used.add(ix)
        util['trajectory_id']=ix
        # The event is authoritative about activation; the recorded path must
        # never continue past it even if grenade entity data lingers.
        tr['flight_end']=min(tr['end'],util['start'])
        if util['pos'] is None:
            util['pos']=tr['points'][-1][1:4]
            util['position_inferred']=True
        if util['owner'] is None:util['owner']=tr['owner']
    # Unmatched projectile endpoints are NOT utility activations. Adding them
    # created duplicate grenades, speculative flashes and lingering trails.
    utilities.sort(key=lambda u:(u['start'],u['type']))
    return utilities




def _grenade_kind(weapon):
    """Translate damage and throw weapon IDs without misclassifying gunfire."""
    w=str(weapon or '').lower().replace('weapon_','').replace('_','')
    if 'flashbang' in w:return 'flash'
    if 'smokegrenade' in w:return 'smoke'
    if 'hegrenade' in w:return 'he'
    if 'inferno' in w or 'molotov' in w or 'incgrenade' in w or 'incendiary' in w:return 'fire'
    if 'decoy' in w:return 'decoy'
    return None


def _frame_player_position(frames, tick, owner, frame_ticks=None):
    """Last observed player position, at or before an event's tick."""
    if owner is None or not frames:return None
    if frame_ticks is None:
        frame_ticks = [f[0] for f in frames]
    j=bisect_right(frame_ticks,tick)-1
    if j<0:return None
    for frame in reversed(frames[max(0,j-5):j+1]):
        sample=next((p for p in frame[1] if p[0]==owner),None)
        if sample:return sample[1:4]
    return None


def complete_trajectories(utilities, trajectories, thrown_events, frames, player_index, rounds):
    """Make trajectories begin at a recorded throw when possible.

    A straight-line fallback is explicitly flagged estimated. It is not a simulated
    Source 2 ballistic path and is only used if a detonation coordinate and an
    observed thrower position are both available. No trajectory is invented for
    a grenade whose origin or destination cannot be established.
    """
    throws=[]
    frame_ticks = [f[0] for f in frames] if frames else None
    for row in thrown_events:
        t=_integer(row.get('tick'))
        if t is None:continue
        kind=_grenade_kind(row.get('weapon') or row.get('grenade_type'))
        if kind is None:continue
        owner=_event_id(row,'user',player_index)
        if owner is None:owner=_event_id(row,'attacker',player_index)
        origin=_position(row,'user_') or _position(row)
        if origin is None:origin=_frame_player_position(frames,t,owner,frame_ticks)
        throws.append({'tick':t,'type':kind,'owner':owner,'entity':_event_entity(row),'pos':origin})
    used=set()
    for util in utilities:
        if util.get('inferred_from_trajectory') or not util.get('pos'):continue
        typ=util['type'];det=util['start'];owner=util['owner']
        choices=[]
        for i,ev in enumerate(throws):
            if i in used or ev['type']!=typ or not (0<=det-ev['tick']<=7*TICK_RATE):continue
            if owner is not None and ev['owner'] is not None and owner!=ev['owner']:continue
            ent=util.get('entity')
            if ent is not None and ev['entity'] is not None and ent!=ev['entity']:continue
            score=det-ev['tick']
            choices.append((score,i,ev))
        match=min(choices,key=lambda a:a[0]) if choices else None
        if match:
            _,ix,ev=match;used.add(ix)
            if owner is None:util['owner']=ev['owner']
            if util.get('trajectory_id') is not None:
                tr=trajectories[util['trajectory_id']]
                # Keep observed positions authoritative; only prepend the throw
                # coordinate if there is no contradictory/earlier recorded point.
                if ev['pos'] and ev['tick']<tr['start']:
                    gap=tr['start']-ev['tick']
                    tr['points'].insert(0,[ev['tick'],*ev['pos']]);tr['start']=ev['tick']
                    tr['launch_estimated']=gap>8
            # Do not invent a throw-to-detonation trajectory. If there are no
            # sampled positions, the grenade's activation is still displayed.
    return trajectories


def build_enemy_damage_events(hurts, player_index, rounds, frames):
    """Health damage to opposing players, from ALL weapons, for running ADR.

    Only count known two-sided encounters, not fall/self/team damage.
    Actor teams are sampled from the replay at or immediately before each hit;
    never guess enemy status when either participant is missing.
    """
    frame_ticks = [f[0] for f in frames]
    results = []
    for row in hurts:
        tick = _integer(row.get('tick'))
        if tick is None or _round_index(rounds, tick) < 0:
            continue
        attacker = _event_id(row, 'attacker', player_index)
        victim = _event_id(row, 'user', player_index)
        if attacker is None or victim is None or attacker == victim:
            continue
        damage = max(0, _integer(row.get('dmg_health'), _integer(row.get('damage'), 0)) or 0)
        if damage == 0:
            continue
        ix = bisect_right(frame_ticks, tick) - 1
        if ix < 0:
            continue
        side = {}
        # The last position sample may not have both participants, so search
        # a short bounded history (<= one second at 8-tick sampling).
        for frame in reversed(frames[max(0, ix-8):ix+1]):
            for player in frame[1]:
                pid = player[0]
                if pid in (attacker, victim) and pid not in side:
                    side[pid] = player[4] if len(player) > 4 else None
            if attacker in side and victim in side:
                break
        if side.get(attacker) not in (2, 3) or side.get(victim) not in (2, 3):
            continue
        if side[attacker] == side[victim]:
            continue
        results.append({'tick':tick,'attacker':attacker,'victim':victim,'damage':damage})
    return results


def associate_utility_impacts(utilities, hurts, blinds, player_index, rounds, trajectories=None):
    """Attribute health/armor damage and flashes to ONE most likely utility.

    Never credit gunfire. Prefer exact owner and grenade entity IDs. Fire is
    matched across its full effect, not just the first eight ticks.
    """
    trajectories=trajectories or []
    for u in utilities:
        u['damage']=[];u['blinded']=[];u['victims']=[]
    damage_events=[]
    def matching(row,kind,tick,attacker,entity=None):
        choices=[]
        for u in utilities:
            if u['type']!=kind or u['round']!=_round_index(rounds,tick):continue
            if attacker is not None and u['owner'] is not None and attacker!=u['owner']:continue
            if entity is not None and u.get('entity') is not None and entity!=u['entity']:continue
            if kind=='fire':
                if not u['start']-8<=tick<=u['end']+8:continue
                dt=max(0,tick-u['start'])
            elif kind in ('flash','smoke','decoy'):
                if not u['start']-3*TICK_RATE<=tick<=u['start']+24:continue
                dt=abs(tick-u['start'])
            else:
                if not u['start']-16<=tick<=u['start']+32:continue
                dt=abs(tick-u['start'])
            # Match a direct projectile hit along the flight before detonation,
            # using known flight intervals; disfavor inferred positions.
            if kind in ('flash','smoke','decoy') and u.get('trajectory_id') is not None:
                ix=u['trajectory_id']
                if 0<=ix<len(trajectories) and trajectories[ix]['start']<=tick<=u['start']+24:
                    dt=min(dt,12)
            choices.append((dt+(4 if u['owner'] is None else 0),u))
        return min(choices,key=lambda x:x[0])[1] if choices else None
    for row in hurts:
        tick=_integer(row.get('tick'))
        kind=_grenade_kind(row.get('weapon'))
        if tick is None or kind is None or _round_index(rounds,tick)<0:continue
        attacker=_event_id(row,'attacker',player_index)
        victim=_event_id(row,'user',player_index)
        health=max(0,_integer(row.get('dmg_health'),_integer(row.get('damage'),0)) or 0)
        armor=max(0,_integer(row.get('dmg_armor'),0) or 0)
        if health<=0 and armor<=0:continue
        impact={'tick':tick,'attacker':attacker,'victim':victim,
                'damage':health,'armor_damage':armor,'weapon':str(row.get('weapon') or ''),
                'pos':_position(row,'user_'),'type':kind}
        damage_events.append(impact)
        u=matching(row,kind,tick,attacker,_event_entity(row) if kind in ('he','flash') else None)
        if u is not None:
            u['damage'].append({'player':victim,'damage':health,'armor_damage':armor,
                                'tick':tick,'pos':impact['pos']})
    for b in blinds:
        tick=_integer(b.get('tick'))
        if tick is None or b.get('player') is None:continue
        # player_blind carries detonation entity on some CS2 builds.
        u=matching(b,'flash',tick,b.get('thrower'),b.get('entity'))
        if u is not None:
            u['blinded'].append({'player':b['player'],'duration':b.get('duration'),'tick':tick})
    for u in utilities:
        u['damage'].sort(key=lambda d:d['tick'])
        u['blinded'].sort(key=lambda d:d['tick'])
        # Legacy 'victims' remains available to older interfaces/tests.
        u['victims']=u['blinded'] if u['type']=='flash' else u['damage']
    return damage_events


def build_rounds(starts: list, ends: list, match_starts: list, freeze_ends: list):
    """Pair starts to next start; include end-of-round intermission for scrubbing."""
    start_rows = {_integer(r['tick']): r for r in starts if _integer(r.get('tick')) is not None}
    starts = sorted(start_rows)
    ends = sorted(ends, key=lambda r: int(r['tick']))
    if match_starts:
        match_tick = min(int(e['tick']) for e in match_starts)
        starts = [x for x in starts if x >= match_tick]
        ends = [e for e in ends if _integer(e['tick']) >= match_tick]
    if not starts and ends:
        # Some community demos omit round_start events; use ends to partition the match.
        ends_ticks = [int(e['tick']) for e in ends]
        starts = [max(0, ends_ticks[0] - 100 * 64)] + [e + 1 for e in ends_ticks[:-1]]
    if not starts:
        return []
    freeze_ticks = sorted(_integer(e.get('tick')) for e in freeze_ends if _integer(e.get('tick')) is not None)
    result = []
    ei = 0
    for i, start in enumerate(starts):
        stop = starts[i + 1] - 1 if i + 1 < len(starts) else None
        while ei < len(ends) and _integer(ends[ei]['tick']) < start:
            ei += 1
        event = ends[ei] if ei < len(ends) and (stop is None or int(ends[ei]['tick']) <= stop) else None
        resolved_end = int(event['tick']) if event else (stop if stop is not None else start + 115 * 64)
        last = stop if stop is not None else resolved_end + 5 * 64
        if last < start:
            continue
        freeze = next((t for t in freeze_ticks if start <= t <= resolved_end), start)
        winner = str(event.get('winner', '')) if event else ''
        if winner.upper() in ('CT', 'COUNTERTERRORIST', '3'):
            winner = 'CT'
        elif winner.upper() in ('T', 'TERRORIST', '2'):
            winner = 'T'
        else:
            winner = ''
        reason = _integer(event.get('reason')) if event else None
        message = str(event.get('message') or '').lower() if event else ''
        if reason == 1 or 'target_bombed' in message:
            win_type = 'explosion'
        elif reason == 7 or 'bomb_defused' in message:
            win_type = 'defuse'
        elif reason in (8, 9) and not any(x in message for x in ('time', 'saved', 'surrender')):
            win_type = 'elimination'
        else:
            win_type = 'other'
        limit = _number(start_rows.get(start, {}).get('timelimit'), 115)
        if limit is None or not 30 <= limit <= 300:
            limit = 115
        result.append({'number': len(result) + 1, 'start': start,
                       'freeze': freeze, 'end': resolved_end,
                       'stop': last, 'winner': winner, 'win_type': win_type,
                       'win_reason': reason, 'round_seconds': limit})
        if event:
            ei += 1
    return result



def infer_elimination_rounds(rounds: list, frames: list, kills: list):
    """Recover a skull result only when every observed opposing player died.

    Some CS2 demos give a generic CT/T round_end reason instead of the
    elimination code. We do not guess a skull from a win alone: require a
    reliable starting roster and an exact death event for every enemy.
    Recorded bomb defuses/explosions always take priority over this heuristic.
    """
    for r in rounds:
        if r.get('winner') not in ('CT', 'T') or r.get('win_type') != 'other':
            continue
        losing_side = 2 if r['winner'] == 'CT' else 3
        frame = next((f for f in frames if r['start'] <= f[0] <= r['end']
                      and any(p[4] == 2 for p in f[1])
                      and any(p[4] == 3 for p in f[1])), None)
        if not frame:
            continue
        opponents = {p[0] for p in frame[1] if p[4] == losing_side}
        if len(opponents) < 2:
            continue
        dead = {k['victim'] for k in kills
                if k.get('victim') is not None and r['start'] <= k['tick'] <= r['end']}
        if opponents <= dead:
            r['win_type'] = 'elimination'
    return rounds


def clamp_bomb_timer(header):
    """Use a recorded setting if present; otherwise the standard 40 s clock."""
    seconds = _number(header.get('mp_c4timer'), _number(header.get('bomb_timer'), 40.0))
    return seconds if seconds and 1 <= seconds <= 120 else 40.0


def clean_team_name(value):
    """Keep authentic non-generic clan names; missing data uses side labels."""
    if value is None:
        return None
    name=str(value).strip().strip('\x00').strip()
    if len(name)>80:
        name=name[:80]
    if not name or name.lower() in ('nan','none','null','unknown','<na>','n/a','t', 'ct',
                                   'terrorist','terrorists','counter-terrorist',
                                   'counter-terrorists','counterterrorist',
                                   'counterterrorists','team ct','team t'):
        return None
    return name


def populate_round_team_names(parser, rounds):
    """Read genuine team names at each round without disrupting position parsing.

    Clan names take precedence. Some demos only populate team_name; generic
    values such as CT/T are ignored and the UI uses its normal side headings.
    Names are stored per round so CT/T switching never pins a name to a side.
    """
    from collections import Counter
    sample_ticks=[]
    for round_ in rounds:
        near_live=max(round_['start'],min(round_['stop'],round_.get('freeze',round_['start'])+16))
        sample_ticks.append(near_live)
    if not sample_ticks:
        return
    for prop in ('team_clan_name','team_name'):
        if all(len(r.get('team_names',{}))==2 for r in rounds):
            break
        try:
            df=parser.parse_ticks(['team_num',prop],ticks=sample_ticks)
        except Exception:
            continue
        if df is None or getattr(df,'empty',True) or not {'tick','team_num',prop}<=set(df.columns):
            continue
        samples={}
        for row in df[['tick','team_num',prop]].itertuples(index=False,name=None):
            tick,side,raw=row
            tick=_integer(tick)
            side=_integer(side)
            if tick is None or side not in (2,3):
                continue
            name=clean_team_name(raw)
            if name:
                samples.setdefault((tick,side),Counter())[name]+=1
        for r,tick in zip(rounds,sample_ticks):
            for side in (2,3):
                count=samples.get((tick,side))
                if count and str(side) not in r.get('team_names',{}):
                    r.setdefault('team_names',{})[str(side)]=count.most_common(1)[0][0]


def extract_demo(path: Path, filename: str):
    from demoparser2 import DemoParser

    parser=DemoParser(str(path))
    header=parser.parse_header() or {}
    map_name=str(header.get('map_name') or 'unknown').lower()
    starts=_events(parser,'round_start')
    ends=_events(parser,'round_end')
    match_starts=_events(parser,'round_announce_match_start')
    freeze=_events(parser,'round_freeze_end')
    rounds=build_rounds(starts,ends,match_starts,freeze)
    if not rounds:
        raise ValueError('No match rounds found in this demo. Try a complete CS2 GOTV/HLTV recording.')
    populate_round_team_names(parser,rounds)
    first,last=rounds[0]['start'],rounds[-1]['stop']
    ticks=list(range(first,last+1,SAMPLE_EVERY_TICKS))
    if ticks[-1]!=last:ticks.append(last)

    # Keep as many optional scoreboard columns as the installed parser supports.
    # Probe optional columns independently so an unsupported inventory property
    # never disables yaw, weapons, or base player position parsing.
    best_base=None
    for candidate in [CORE_PROPS+STAT_PROPS,CORE_PROPS+STAT_PROPS[:-1],
                      CORE_PROPS+STAT_PROPS[:5], CORE_PROPS+['balance','flash_duration'],
                      CORE_PROPS+['balance'],CORE_PROPS, ['X','Y','team_num','player_color'],
                      ['X','Y','team_num']]:
        try:
            test=parser.parse_ticks(candidate,ticks=ticks[:min(len(ticks),32)])
            if test is not None and not test.empty:
                best_base=candidate;break
        except Exception:continue
    if best_base is None:
        best_base=CORE_PROPS
    supported=[]
    for prop in VIEW_PROPS:
        try:
            test=parser.parse_ticks(best_base+[prop],ticks=ticks[:min(len(ticks),32)])
            if test is not None and prop in test.columns:supported.append(prop)
        except Exception:pass
    prop_sets=[]
    # Graceful downgrade: unsupported inventory encoding should not erase
    # successfully decoded angles or active guns from a particular demo.
    for extras in (supported,[x for x in supported if x!='inventory'],
                   [x for x in supported if x in ('yaw','active_weapon_name','armor','has_helmet','has_defuser')],
                   [x for x in supported if x in ('yaw','active_weapon_name')],
                   [x for x in supported if x=='yaw'],[]):
        candidate=best_base+extras
        if candidate not in prop_sets:prop_sets.append(candidate)
    prop_sets.extend([CORE_PROPS,['X','Y','team_num']])
    df=None
    for prop_set in prop_sets:
        try:
            df=parser.parse_ticks(prop_set,ticks=ticks)
            if df is not None and not df.empty:break
        except Exception:
            continue
    if df is None or df.empty or not {'tick','X','Y'}<=set(df.columns):
        raise ValueError('No player coordinates could be read. The recording may be incomplete.')

    player_index={};players=[];frames=[];positions=[];current_tick=None
    xs=[];ys=[];loadouts=[];last_loadout={}
    columns=list(df.columns)
    colindex={key:columns.index(key) for key in columns}
    def field(row,key,default=None):return row[colindex[key]] if key in colindex else default
    for row in (df if df['tick'].is_monotonic_increasing else df.sort_values('tick')).itertuples(index=False,name=None):
        tick=_integer(field(row,'tick'))
        x,y=_number(field(row,'X')),_number(field(row,'Y'))
        if tick is None or x is None or y is None or abs(x)>100000 or abs(y)>100000:
            continue
        if current_tick is not None and tick!=current_tick:
            if positions:frames.append([current_tick,positions])
            positions=[]
        current_tick=tick
        name=str(field(row,'name','') or 'Unknown')[:75]
        sid=_integer(field(row,'steamid'),0)
        sid_str=str(sid) if sid else 'bot:'+name
        if sid_str not in player_index:
            player_index[sid_str]=len(players)
            players.append({'id':sid_str,'name':name})
        ix=player_index[sid_str]
        if name!='Unknown':players[ix]['name']=name
        side=_integer(field(row,'team_num'),0)
        if side not in (2,3):continue
        color=_integer(field(row,'player_color'),-1)
        if color is None or color<0 or color>4:color=-1
        hp=_integer(field(row,'health'),100)
        if field(row,'is_alive') is False or (hp is not None and hp<=0):hp=0
        stats=[_integer(field(row,prop)) for prop in STAT_PROPS[:-1]]
        flash=_number(field(row,'flash_duration'))
        yaw=_number(field(row,'yaw'))
        active=str(field(row,'active_weapon_name') or '').strip()
        if active.lower() in ('nan','none','null'):active=''
        inventory=_inventory_items(field(row,'inventory'))
        armor=_integer(field(row,'armor'))
        helmet=field(row,'has_helmet')
        defuser=field(row,'has_defuser')
        if _number(helmet) is None and not isinstance(helmet,(bool,str)):helmet=None
        if _number(defuser) is None and not isinstance(defuser,(bool,str)):defuser=None
        equipment={'active':active,'weapons':inventory,
                   'armor':armor,'helmet':bool(helmet) if helmet is not None else None,
                   'defuser':bool(defuser) if defuser is not None else None}
        # Cache only changes; thousands of repeated inventory arrays per frame
        # would massively increase replay JSON size.
        if last_loadout.get(ix)!=equipment:
            loadouts.append({'tick':tick,'player':ix,**equipment})
            last_loadout[ix]=equipment
        # [id, x, y, z, side, color, hp, K, A, D, UD, EF, money, flash_secs, yaw]
        positions.append([ix,round(x,1),round(y,1),round(_number(field(row,'Z'),0),1),
                          side,color,hp,*stats,round(flash,2) if flash is not None else None, round(yaw,2) if yaw is not None else None])
        if x!=0 or y!=0:xs.append(x);ys.append(y)
    if current_tick is not None and positions:frames.append([current_tick,positions])
    if not frames:raise ValueError('No playable CT/T positions found.')

    def bounds(values):
        if not values:return [-2000,2000]
        values.sort()
        lo=values[int(len(values)*.005)];hi=values[min(len(values)-1,int(len(values)*.995))]
        if hi<=lo:hi=lo+1024
        mid=(lo+hi)/2;spread=(hi-lo)*.62+250
        return [round(mid-spread,1),round(mid+spread,1)]

    # Events contain exact ticks, unlike motion frames sampled every 8 ticks.
    deaths=_events(parser,'player_death',True)
    kills=build_kills(deaths,rounds,player_index)
    infer_elimination_rounds(rounds,frames,kills)
    shots=build_shots(_events(parser,'weapon_fire',True),rounds,player_index,frames)
    bomb_events=build_bomb_events({name:_events(parser,name,True) for name in ('bomb_pickup','bomb_dropped','bomb_planted','bomb_defused','bomb_exploded','bomb_begindefuse','bomb_abortdefuse','player_given_c4')},rounds,player_index,frames)
    bomb_events=infer_bomb_inventory_events(loadouts,rounds,bomb_events,frames)
    # A direct defuse/explosion event is more precise than a generic round_end
    # reason, including recordings that omit the reason numeric field.
    for bomb_event in bomb_events:
        if bomb_event.get('outcome') in ('defuse', 'explosion'):
            round_ = rounds[bomb_event['round']]
            round_['win_type'] = bomb_event['outcome']
            if not round_['winner']:
                round_['winner'] = 'CT' if bomb_event['outcome'] == 'defuse' else 'T'
    hurts=_events(parser,'player_hurt',True)
    raw_blinds=_events(parser,'player_blind',True)
    frame_ticks=[x[0] for x in frames]
    blinds=build_blinds(raw_blinds,player_index,frames,frame_ticks)
    event_names=set(UTILITY_TYPES)|set(END_EVENTS.values())|{'inferno_extinguish'}
    utilities_raw={name:_events(parser,name,True) for name in event_names}
    if utilities_raw.get('inferno_extinguish'):
        utilities_raw['inferno_expire'].extend(utilities_raw['inferno_extinguish'])
        utilities_raw['inferno_expire'].sort(key=lambda r:int(r['tick']))
    utilities=build_utility(utilities_raw,rounds,player_index,hurts,blinds)
    trajectories=parse_trajectory(parser,utilities,player_index,first,last,players)
    utilities=enrich_utility_with_trajectories(utilities,trajectories,rounds)
    thrown=_events(parser,'grenade_thrown',True)
    trajectories=complete_trajectories(utilities,trajectories,thrown,frames,player_index,rounds)
    damage_events=associate_utility_impacts(utilities,hurts,blinds,player_index,rounds,trajectories)
    enemy_damage_events=build_enemy_damage_events(hurts,player_index,rounds,frames)
    return {
        'version':2,'filename':filename,'map':map_name,'tick_rate':TICK_RATE,
        'sample_stride':SAMPLE_EVERY_TICKS,'start':first,
        'end':min(rounds[-1]['stop'],frames[-1][0]),'rounds':rounds,
        'players':players,'bounds':{'x':bounds(xs),'y':bounds(ys)},'frames':frames,
        'kills':kills,'shots':shots,'loadouts':loadouts,'bomb_events':bomb_events,'bomb_timer_seconds':clamp_bomb_timer(header),'utility':utilities,'blinds':blinds,'trajectories':trajectories,
        'damage_events':damage_events,'enemy_damage_events':enemy_damage_events,
        'utility_diagnostics':{'total':len(utilities),
            'event_based':sum(not u.get('inferred_from_trajectory',False) for u in utilities),
            'projectile_inferred':sum(bool(u.get('inferred_from_trajectory')) for u in utilities),
            'without_position':sum(u['pos'] is None for u in utilities),
            'trajectory_count':len(trajectories),
            'measured_trajectories':sum(not t.get('estimated',False) for t in trajectories),
            'estimated_trajectories':sum(bool(t.get('estimated',False)) for t in trajectories)},
        'available_stats':[p for p in STAT_PROPS if p in colindex],
        'limits':{'sampling_ticks':SAMPLE_EVERY_TICKS,
                  'area_estimates':True,'utility_end_estimated_if_missing':True,
                  'yaw_available':'yaw' in colindex, 'equipment_available':bool(supported),
                  'shot_events':len(shots), 'adr_available':bool(hurts)},
    }
