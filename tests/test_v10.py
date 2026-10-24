"""v10: recorded kill flags, no phantom endpoints, and smoke flight cut-off."""
from parser import (build_kills, build_blinds, parse_trajectory,
                    enrich_utility_with_trajectories, trim_stationary_tail)
import pandas as pd

R = [{'start':100, 'end':1000, 'stop':1010}]
IDS={'101':0,'102':1,'103':2}

def test_recorded_killfeed_flags_and_metadata():
    ks=build_kills([{'tick':200,'attacker_steamid':101,'user_steamid':102,
        'weapon':'awp','headshot':1,'penetrated':2,'thrusmoke':True,
        'noscope':True,'attackerblind':False,'attackerinair':1}], R, IDS)
    assert len(ks)==1
    assert ks[0]['headshot'] and ks[0]['wallbang'] and ks[0]['thrusmoke']
    assert ks[0]['noscope'] and ks[0]['jumping'] and not ks[0]['attackerblind']
    assert ks[0]['weapon']=='awp'

def test_flash_event_duration_preferred_to_stale_player_prop():
    frames=[[200,[[1,0,0,0,2,0,80,0,0,0,0,0,100,0,0]]],
            [208,[[1,0,0,0,2,0,80,0,0,0,0,0,100,3,0]]]]
    blind=[{'tick':200,'user_steamid':102,'attacker_steamid':101,
            'blind_duration':3.1,'user_flash_duration':0}]
    results=build_blinds(blind,IDS,frames,[200,208])
    assert results[0]['duration']==3.1
    assert results[0]['player']==1 and results[0]['thrower']==0


def test_flash_duration_can_fallback_to_sampled_value():
    frames=[[200,[[1,0,0,0,2,0,80,0,0,0,0,0,100,0,0]]],
            [208,[[1,0,0,0,2,0,80,0,0,0,0,0,100,2.7,0]]]]
    events=[{'tick':200,'user_steamid':102,'attacker_steamid':101,'user_flash_duration':0}]
    assert build_blinds(events,IDS,frames,[200,208])[0]['duration']==2.7


def test_static_smoke_tail_trimmed_to_landing():
    points=[[100,0,0,20],[108,20,0,10],[116,40,0,0],
            [124,40,0,0],[132,40,0,0],[140,40,0,0],[200,40,0,0],[500,40,0,0]]
    trimmed=trim_stationary_tail(points)
    assert trimmed[-1][0]==116
    class Demo:
        def parse_grenades(self):
            return pd.DataFrame([{'tick':p[0],'x':p[1],'y':p[2],'z':p[3],
                'entity_id':33,'grenade_type':'SmokeGrenade','steamid':101} for p in points])
    tracks=parse_trajectory(Demo(),[],IDS,100,600)
    assert len(tracks)==1 and tracks[0]['end']==116


def test_smoke_event_remains_when_trajectory_absent_and_no_inference():
    utils=[{'type':'smoke','round':0,'start':116,'end':1400,'entity':33,'owner':0,'pos':[40,0,0]}]
    tracks=[{'type':'smoke','start':100,'end':500,'entity':33,'owner':0,
             'points':[[100,0,0,20],[116,40,0,0]]}]
    out=enrich_utility_with_trajectories(utils,tracks,R)
    assert len(out)==1 and out[0]['trajectory_id']==0
    assert tracks[0]['flight_end']==116
    assert enrich_utility_with_trajectories([], tracks, R)==[]
