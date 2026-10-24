"""Version 5: aiming/shooting and optional loadout parsing contracts."""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from parser import _inventory_items,build_shots


def test_equipment_inventory_normalization():
    assert _inventory_items(['weapon_awp','weapon_flashbang','weapon_awp']) == ['weapon_awp','weapon_flashbang']
    assert _inventory_items("['weapon_ak47', 'weapon_smokegrenade']") == ['weapon_ak47','weapon_smokegrenade']
    assert _inventory_items(None) is None


def test_shot_positions_aim_and_grenade_exclusion():
    rounds=[{'start':100,'stop':500}]
    frame=[[110,[[0,150.0,250.0,10,3,0,100,None,None,None,None,None,3200,None,90.0]]]]
    player_index={'76561190000000001':0}
    events=[{'tick':114,'user_steamid':76561190000000001,'weapon':'ak47'},
            {'tick':115,'user_steamid':76561190000000001,'weapon':'flashbang'},
            {'tick':116,'user_steamid':76561190000000001,'weapon':'smokegrenade'}]
    shots=build_shots(events,rounds,player_index,frame)
    assert len(shots)==1
    assert shots[0]['yaw']==90.0
    assert shots[0]['pos']==[150.0,250.0,10]
    assert shots[0]['owner']==0
