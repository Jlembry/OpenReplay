"""OpenReplay v8 regression tests for CS2 grenade paths and utility impacts."""
import pandas as pd
from parser import (parse_trajectory, complete_trajectories,
                    associate_utility_impacts)

ROUNDS=[{'start':100,'stop':900}]
INDEX={'101':0,'102':1,'103':2}

class FakeParser:
    def parse_grenades(self):
        # The parser also emits lowercase x/y/z columns on some builds.
        return pd.DataFrame([
            {'tick':190,'entity_id':300,'grenade_type':'Flashbang','name':'Alpha','steamid':101,'x':10,'y':20,'z':100},
            {'tick':195,'entity_id':300,'grenade_type':'Flashbang','name':'Alpha','steamid':101,'x':25,'y':28,'z':80},
            {'tick':204,'entity_id':300,'grenade_type':'Flashbang','name':'Alpha','steamid':101,'x':48,'y':49,'z':0},
            {'tick':200,'entity_id':301,'grenade_type':'HeGrenade','name':'Bravo','steamid':102,'x':30,'y':30,'z':90},
            {'tick':210,'entity_id':301,'grenade_type':'HeGrenade','name':'Bravo','steamid':102,'x':80,'y':80,'z':0},
        ])

def util(kind,start,owner,entity,pos,end=None):
    return {'type':kind,'start':start,'end':end or start+64,'owner':owner,'entity':entity,
            'pos':pos,'round':0,'estimated_end':False,'victims':[]}

def test_records_lowercase_coordinate_grenade_paths_with_real_owner():
    tracks=parse_trajectory(FakeParser(),[],INDEX,100,900,
        [{'name':'Alpha'},{'name':'Bravo'},{'name':'Charlie'}])
    assert len(tracks)==2
    flash=next(x for x in tracks if x['type']=='flash')
    assert flash['owner']==0 and flash['entity']==300
    assert flash['points'][0]==[190,10,20,100]
    assert flash['points'][-1]==[204,48,49,0]
    assert not flash['estimated']

def test_prepend_recorded_throw_but_never_draw_estimated_fallback():
    tracks=parse_trajectory(FakeParser(),[],INDEX,100,900,
        [{'name':'Alpha'},{'name':'Bravo'},{'name':'Charlie'}])
    utilities=[util('flash',205,0,300,[48,49,0]),util('smoke',600,2,400,[500,600,0])]
    from parser import enrich_utility_with_trajectories
    enrich_utility_with_trajectories(utilities,tracks,ROUNDS)
    frames=[[100,[[0,0,0,0],[2,400,450,0]]],[180,[[0,3,4,0],[2,480,530,0]]],
            [200,[[0,10,20,0],[2,485,540,0]]],[500,[[2,410,450,0]]],
            [520,[[2,420,465,0]]]]
    thrown=[{'tick':180,'user_steamid':101,'weapon':'weapon_flashbang','user_X':3,'user_Y':4,'user_Z':0}]
    complete_trajectories(utilities,tracks,thrown,frames,INDEX,ROUNDS)
    assert tracks[utilities[0]['trajectory_id']]['start']==180
    assert tracks[utilities[0]['trajectory_id']]['points'][0]==[180,3,4,0]
    smoke_event=next(u for u in utilities if u['type']=='smoke')
    assert smoke_event.get('trajectory_id') is None # no synthetic throw-to-smoke flight


def test_all_damage_and_flash_impacts_associated_not_just_first_fire_tick():
    grenades=[util('flash',205,0,300,[48,49,0]),
              util('fire',400,0,310,[150,180,0],end=700),
              util('he',310,1,301,[80,80,0])]
    hurts=[
        {'tick':198,'weapon':'flashbang','attacker_steamid':101,'user_steamid':102,'dmg_health':1},
        {'tick':316,'weapon':'hegrenade','attacker_steamid':102,'user_steamid':103,'dmg_health':43,'dmg_armor':4},
        {'tick':410,'weapon':'inferno','attacker_steamid':101,'user_steamid':103,'dmg_health':8},
        {'tick':550,'weapon':'inferno','attacker_steamid':101,'user_steamid':103,'dmg_health':12},
        {'tick':620,'weapon':'ak47','attacker_steamid':101,'user_steamid':103,'dmg_health':32},
    ]
    blinded=[{'tick':206,'player':1,'thrower':0,'entity':300,'duration':1.4},
             {'tick':208,'player':2,'thrower':0,'entity':300,'duration':3.1}]
    result=associate_utility_impacts(grenades,hurts,blinded,INDEX,ROUNDS)
    assert len(result)==4
    flash,fire,he=grenades
    assert flash['damage'][0]['damage']==1 and flash['damage'][0]['player']==1
    assert {(x['player'],x['duration']) for x in flash['blinded']}=={(1,1.4),(2,3.1)}
    assert [x['damage'] for x in fire['damage']]==[8,12]
    assert he['damage'][0]['damage']==43 and he['damage'][0]['armor_damage']==4
    assert 32 not in [e['damage'] for e in result]


def test_not_guessing_incomplete_throw_without_origin_or_owner():
    tracks=[]
    grenades=[util('smoke',300,None,9,[100,200,0])]
    complete_trajectories(grenades,tracks,[],[],INDEX,ROUNDS)
    assert tracks==[] and grenades[0].get('trajectory_id') is None
