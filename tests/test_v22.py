from pathlib import Path
import sys
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from parser import clean_team_name,populate_round_team_names


def test_team_names_change_sides_at_halftime():
    rounds=[{'start':100,'freeze':120,'stop':900},
            {'start':1000,'freeze':1020,'stop':1900}]
    class Demo:
        def parse_ticks(self, props, ticks):
            assert props==['team_num','team_clan_name']
            assert ticks==[136,1036]
            return pd.DataFrame([
                {'tick':136,'team_num':3,'team_clan_name':'Team Spirit'},
                {'tick':136,'team_num':2,'team_clan_name':'Natus Vincere'},
                {'tick':1036,'team_num':3,'team_clan_name':'Natus Vincere'},
                {'tick':1036,'team_num':2,'team_clan_name':'Team Spirit'},
            ])
    populate_round_team_names(Demo(),rounds)
    assert rounds[0]['team_names']=={'3':'Team Spirit','2':'Natus Vincere'}
    assert rounds[1]['team_names']=={'3':'Natus Vincere','2':'Team Spirit'}


def test_team_name_fallback_when_clan_name_is_unavailable():
    rounds=[{'start':100,'freeze':120,'stop':900}]
    class Demo:
        def parse_ticks(self, props, ticks):
            if 'team_clan_name' in props: raise ValueError('no field')
            return pd.DataFrame([
                {'tick':136,'team_num':3,'team_name':'G2'},
                {'tick':136,'team_num':2,'team_name':'T'},
            ])
    populate_round_team_names(Demo(),rounds)
    assert rounds[0]['team_names']=={'3':'G2'}


def test_missing_names_and_generic_names_leave_side_fallbacks():
    rounds=[{'start':100,'freeze':120,'stop':900}]
    class Demo:
        def parse_ticks(self, props, ticks):
            if 'team_clan_name' in props:
                return pd.DataFrame([{'tick':136,'team_num':3,'team_clan_name':'CT'},
                                     {'tick':136,'team_num':2,'team_clan_name':None}])
            return pd.DataFrame([{'tick':136,'team_num':3,'team_name':'Counter-Terrorists'},
                                 {'tick':136,'team_num':2,'team_name':'Terrorists'}])
    populate_round_team_names(Demo(),rounds)
    assert rounds[0].get('team_names',{})=={}
    assert clean_team_name(float('nan')) is None
    assert clean_team_name(' Team Falcons ')=='Team Falcons'


def test_team_probe_failure_never_stops_demo():
    rounds=[{'start':100,'freeze':120,'stop':900}]
    class Demo:
        def parse_ticks(self,*args,**kwargs):
            raise Exception('missing optional prop')
    populate_round_team_names(Demo(),rounds)
    assert 'team_names' not in rounds[0]
