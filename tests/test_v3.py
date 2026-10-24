"""Regression cases for utility not rendering when events omit positions."""
from parser import enrich_utility_with_trajectories, build_utility, parse_trajectory
import pandas as pd

R = [{'start':100,'stop':10000,'end':9900,'freeze':110,'winner':'CT','number':1}]


def _path(kind,entity,start,x,y,steamid=76561190000000001):
    return {'type':kind,'start':start,'end':start+60,'owner':0,'points':[
      [start,x-110,y-110,120],[start+30,x-40,y-35,50],[start+60,x,y,0]]}


def test_utility_missing_event_position_uses_grenade_end_point():
    utility = build_utility({'smokegrenade_detonate':[{'tick':360,'user_steamid':76561190000000001}]},R,{'76561190000000001':0})
    assert utility[0]['pos'] is None
    paths=[_path('smoke',8,300,400,250)]
    enriched=enrich_utility_with_trajectories(utility,paths,R)
    assert len(enriched)==1
    assert enriched[0]['pos']==[400,250,0]
    assert enriched[0]['position_inferred']
    assert enriched[0].get('inferred_from_trajectory') is None
    assert enriched[0]['estimated_end']


def test_unmatched_projectiles_are_not_inferred_as_utility_events():
    paths=[_path('flash',3,400,300,400),_path('smoke',4,500,600,200)]
    enriched=enrich_utility_with_trajectories([],paths,R)
    assert enriched==[]  # No speculative endpoint flashes or smokes


def test_multiple_missing_position_fires_same_tick_not_collapsed():
    ev={'inferno_startburn':[{'tick':500,'user_steamid':76561190000000001},
                             {'tick':500,'user_steamid':76561190000100001}]}
    result=build_utility(ev,R,{'76561190000000001':0,'76561190000100001':1})
    assert len(result)==2


def test_realistic_parser_grenade_column_names():
    class FakeParser:
        def parse_grenades(self):
            return pd.DataFrame([
                {'entity_id':120,'grenade_type':'SmokeGrenade','name':'one',
                 'steamid':76561190000000001,'tick':t,'x':x,'y':250.0,'z':32}
                for t,x in ((301,60),(309,160),(317,200))
            ])
    tracks=parse_trajectory(FakeParser(),[],{'76561190000000001':0},100,1000)
    assert len(tracks)==1
    assert tracks[0]['type']=='smoke'
    assert tracks[0]['owner']==0
    assert tracks[0]['points'][-1][1:3]==[200.0,250.0]


def test_grenade_trajectory_resolves_late_thrower_and_splits_reused_entities():
    class Parser:
        def parse_grenades(self):
            return pd.DataFrame([
                {'entity_id':55,'grenade_type':'Flashbang','tick':t,'x':x,'y':30.,'z':5.,'thrower_steamid':steamid}
                for t,x,steamid in ((100,10,None),(101,12,76561190000000001),
                                     (500,40,76561190000100001),(501,44,76561190000100001))
            ])
    tracks=parse_trajectory(Parser(),[],{'76561190000000001':0,'76561190000100001':1},100,1000)
    assert len(tracks)==2
    assert tracks[0]['owner']==0 and tracks[1]['owner']==1
    assert tracks[0]['start']==100 and tracks[0]['end']==101
