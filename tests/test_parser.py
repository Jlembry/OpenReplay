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


def test_cs2_faceit_knife_warmup_and_string_reasons():
    starts = [
        {'tick': 1, 'round': 1, 'is_warmup_period': False, 'total_rounds_played': 0},
        {'tick': 2812, 'round': 1, 'is_warmup_period': True, 'total_rounds_played': 0},
        {'tick': 3295, 'round': 1, 'is_warmup_period': False, 'total_rounds_played': 0},
        {'tick': 3370, 'round': 1, 'is_warmup_period': False, 'total_rounds_played': 0},
        {'tick': 6922, 'round': 2, 'is_warmup_period': False, 'total_rounds_played': 1},
    ]
    ends = [
        {'tick': 1, 'round': 0, 'winner': None, 'reason': None, 'is_warmup_period': False},
        {'tick': 2663, 'round': 1, 'winner': 'T', 'reason': 'ct_killed', 'is_warmup_period': False},
        {'tick': 6474, 'round': 2, 'winner': 'CT', 'reason': 't_killed', 'is_warmup_period': False},
        {'tick': 14454, 'round': 3, 'winner': 'CT', 'reason': 'bomb_defused', 'is_warmup_period': False},
    ]
    match_starts = [{'tick': 1280}, {'tick': 5066}]
    freeze_ends = [
        {'tick': 1280, 'is_warmup_period': False},
        {'tick': 2939, 'is_warmup_period': True},
        {'tick': 5066, 'is_warmup_period': False},
        {'tick': 9461, 'is_warmup_period': False},
    ]
    r = build_rounds(starts, ends, match_starts, freeze_ends)
    assert len(r) == 2
    assert r[0]['start'] == 3370 and r[0]['freeze'] == 5066 and r[0]['end'] == 6474
    assert r[0]['winner'] == 'CT' and r[0]['win_type'] == 'elimination'
    assert r[1]['start'] == 6922 and r[1]['freeze'] == 9461 and r[1]['end'] == 14454
    assert r[1]['winner'] == 'CT' and r[1]['win_type'] == 'defuse'


def test_panic_base_exception_and_tick_round_recovery(tmp_path):
    class SimPanic(BaseException):
        pass

    class PanicEventParser:
        def __init__(self, path):
            pass
        def parse_header(self):
            return {'map_name': 'de_dust2'}
        def parse_event(self, *args, **kwargs):
            raise SimPanic('rust panic in event stream')
        def parse_ticks(self, props, ticks=None):
            if ticks is None:
                return pd.DataFrame([
                    {'tick': 100, 'is_warmup_period': True, 'total_rounds_played': 0},
                    {'tick': 500, 'is_warmup_period': False, 'total_rounds_played': 0},
                    {'tick': 1100, 'is_warmup_period': False, 'total_rounds_played': 0},
                    {'tick': 1200, 'is_warmup_period': False, 'total_rounds_played': 1},
                    {'tick': 1800, 'is_warmup_period': False, 'total_rounds_played': 1},
                ])
            rows = []
            for tick in ticks:
                for pid in range(2):
                    rows.append({
                        'tick': tick, 'X': 10.0 + pid * 50, 'Y': 20.0 + pid * 50, 'Z': 0.0,
                        'health': 100, 'is_alive': True, 'player_color': pid,
                        'team_num': 2 + pid, 'steamid': 76561190000000010 + pid,
                        'name': ['p1', 'p2'][pid],
                    })
            return pd.DataFrame(rows)

    with patch.dict(sys.modules, {'demoparser2': types.SimpleNamespace(DemoParser=PanicEventParser)}):
        demo = extract_demo(tmp_path / 'panic.dem', 'panic.dem')
    assert demo['map'] == 'de_dust2'
    assert len(demo['rounds']) == 2
    assert demo['rounds'][0]['start'] == 500
    assert demo['rounds'][1]['start'] == 1200
