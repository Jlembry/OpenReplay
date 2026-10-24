"""Regressions for v6 bomb tracking / complete inventories."""
from parser import build_bomb_events, _inventory_items


def test_inventory_preserves_two_flashbangs():
    assert _inventory_items(['weapon_ak47','weapon_flashbang','weapon_flashbang']).count('weapon_flashbang') == 2
    assert _inventory_items("['weapon_flashbang','weapon_flashbang']").count('weapon_flashbang') == 2
    assert _inventory_items(None) is None


def test_bomb_carrier_pickup_drop_plant_and_rounds():
    rounds=[{'start':100,'stop':500},{'start':501,'stop':900}]
    players={'123':0, '456':1}
    events={
       'bomb_pickup':[{'tick':110,'user_steamid':123},{'tick':235,'user_steamid':456},
                      {'tick':550,'user_steamid':123}],
       'bomb_dropped':[{'tick':210,'user_steamid':123}],
       'bomb_planted':[{'tick':330,'user_steamid':456}],
    }
    result=build_bomb_events(events,rounds,players)
    assert [(e['tick'],e['type'],e['player']) for e in result]==[
      (110,'pickup',0),(210,'dropped',None),(235,'pickup',1),(330,'planted',None),(550,'pickup',0)]
    assert [x['round'] for x in result]==[0,0,0,0,1]


def test_bomb_without_events_is_unknown_not_invented():
    assert build_bomb_events({},[{'start':100,'stop':200}],{})==[]
