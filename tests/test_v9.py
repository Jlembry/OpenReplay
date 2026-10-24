"""OpenReplay v9 ADR regression: only recorded enemy health damage counts."""
from parser import build_enemy_damage_events

ROUNDS=[{'start':100,'stop':499},{'start':500,'stop':899}]
INDEX={'101':0,'102':1,'103':2}
FRAMES=[
    [100,[[0,0,0,0,3],[1,10,0,0,2],[2,20,0,0,3]]],
    [200,[[0,0,0,0,3],[1,10,0,0,2],[2,20,0,0,3]]],
    [500,[[0,0,0,0,2],[1,10,0,0,3],[2,20,0,0,2]]],
]

def evt(tick,actor,target,damage,weapon='ak47'):
    return {'tick':tick,'attacker_steamid':actor,'user_steamid':target,
            'dmg_health':damage,'weapon':weapon}

def test_adr_enemy_damage_includes_all_weapons_excludes_team_and_self():
    events=[evt(125,101,102,35),evt(131,101,102,29,'hegrenade'),
            evt(148,101,103,60),  # friendly fire -> not ADR
            evt(170,101,101,20),  # self damage -> not ADR
            evt(540,101,102,50,'m4a1'), # teams swapped -> still enemies
            evt(560,0,102,40), # world damage -> not ADR
            evt(600,101,103,15)] # now on same team
    actual=build_enemy_damage_events(events,INDEX,ROUNDS,FRAMES)
    assert [(x['tick'],x['damage']) for x in actual]==[(125,35),(131,29),(540,50)]

def test_adr_no_unverifiable_team_or_zero_damage():
    assert not build_enemy_damage_events([evt(135,101,102,40)],INDEX,ROUNDS,[])
    assert not build_enemy_damage_events([evt(135,101,102,0)],INDEX,ROUNDS,FRAMES)
