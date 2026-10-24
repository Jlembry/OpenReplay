from __future__ import annotations
import sys
import types
from pathlib import Path
from unittest.mock import patch
import pandas as pd
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from parser import _events, build_rounds, extract_demo


def test_round_construction():
    start=[{'tick':100},{'tick':1000},{'tick':2000}]
    ends=[{'tick':800,'winner':'CT'},{'tick':1900,'winner':'T'},{'tick':2800,'winner':3}]
    r=build_rounds(start,ends,[],[{'tick':300},{'tick':1500},{'tick':2300}])
    assert [x['number'] for x in r]==[1,2,3]
    assert r[0]['stop']==999 and r[1]['stop']==1999
    assert [x['winner'] for x in r]==['CT','T','CT']
    assert r[1]['freeze']==1500


def test_warmup_filter():
    r=build_rounds([{'tick':0},{'tick':900},{'tick':2200}],
                  [{'tick':700},{'tick':1900},{'tick':2900}],
                  [{'tick':800}],[])
    assert len(r)==2
    assert r[0]['start']==900


def test_round_end_fallback():
    r=build_rounds([],[{'tick':900,'winner':'T'},{'tick':1800,'winner':'CT'}],[],[])
    assert len(r)==2


def test_extract_sampled_players_with_mock_backend(tmp_path):
    class FakeDemoParser:
        def __init__(self,path):pass
        def parse_header(self):return {'map_name':'de_mirage'}
        def parse_event(self,event):
            if event=='round_start':return pd.DataFrame([{'tick':200},{'tick':1200}])
            if event=='round_end':return pd.DataFrame([{'tick':1100,'winner':'CT'},{'tick':2100,'winner':'T'}])
            return pd.DataFrame()
        def parse_ticks(self,props,ticks):
            rows=[]
            for tick in ticks:
                for pid in range(2):
                    rows.append({'tick':tick,'X':-100+tick*.25+pid*200,'Y':200+pid*100,
                      'Z':25.0,'health':100,'is_alive':True,'player_color':pid,
                      'team_num':2+pid,'steamid':76561190000000000+pid,'name':['alpha','bravo'][pid]})
            return pd.DataFrame(rows)
    with patch.dict(sys.modules,{'demoparser2':types.SimpleNamespace(DemoParser=FakeDemoParser)}):
        demo=extract_demo(tmp_path/'mock.dem','mock.dem')
    assert demo['map']=='de_mirage'
    assert len(demo['rounds'])==2
    assert len(demo['frames'])>100
    assert len(demo['players'])==2
    assert demo['frames'][0][1][0][5]==0
    assert demo['frames'][0][1][1][5]==1
    assert demo['players'][0]['id']=='76561190000000000'
    assert demo['players'][1]['name']=='bravo'
    assert demo['start']==200


def test_invalid_missing_rounds(tmp_path):
    class BadParser:
        def __init__(self,path):pass
        def parse_header(self):return {'map_name':'de_nuke'}
        def parse_event(self,event):return pd.DataFrame()
    with patch.dict(sys.modules,{'demoparser2':types.SimpleNamespace(DemoParser=BadParser)}):
        with pytest.raises(ValueError,match='No match rounds'):
            extract_demo(tmp_path/'bad.dem','bad.dem')
