"""v13: authoritative round outcomes and bomb handoff recovery."""
from parser import build_rounds, infer_bomb_inventory_events, actor_position_at


def test_round_wins_classified_and_clocks_retained():
    starts=[{'tick':100,'timelimit':115},{'tick':1100,'timelimit':115},
            {'tick':2100,'timelimit':115},{'tick':3100,'timelimit':115}]
    ends=[{'tick':800,'winner':3,'reason':7},
          {'tick':1700,'winner':2,'reason':1},
          {'tick':2800,'winner':3,'reason':8}]
    rounds=build_rounds(starts,ends,[],[{'tick':140},{'tick':1140}])
    assert [r['win_type'] for r in rounds]==['defuse','explosion','elimination','other']
    assert [r['winner'] for r in rounds]==['CT','T','CT','']
    assert rounds[0]['freeze']==140 and rounds[0]['round_seconds']==115
    assert rounds[0]['end']==800


def test_bomb_handoff_same_tick_not_dropped():
    rounds=[{'start':100,'stop':999}]
    loadouts=[{'tick':100,'player':0,'weapons':['weapon_ak47','weapon_c4']},
              {'tick':100,'player':1,'weapons':['weapon_ak47']},
              # New owner's update deliberately precedes previous owner's update.
              {'tick':250,'player':1,'weapons':['weapon_ak47','weapon_c4']},
              {'tick':250,'player':0,'weapons':['weapon_ak47']}]
    out=infer_bomb_inventory_events(loadouts,rounds,[],[])
    assert [(e['type'],e['player']) for e in out]==[('pickup',0),('pickup',1)]
    assert out[1]['tick']==250


def test_recorded_plant_blocks_late_false_carrier():
    rounds=[{'start':100,'stop':999}]
    recorded=[{'tick':350,'round':0,'type':'planted','pos':[35,22,0],'source':'event'}]
    loadouts=[{'tick':100,'player':0,'weapons':['weapon_c4']},
              {'tick':460,'player':1,'weapons':['weapon_c4']}]
    out=infer_bomb_inventory_events(loadouts,rounds,recorded,[])
    assert not any(e['type']=='pickup' and e['tick']>350 for e in out)
    assert any(e['type']=='planted' for e in out)


def test_explicit_pickup_overrides_inventory_lag():
    rounds=[{'start':100,'stop':999}]
    recorded=[{'tick':205,'round':0,'type':'pickup','player':1,'source':'event'}]
    loadouts=[{'tick':100,'player':0,'weapons':['weapon_c4']},
              {'tick':230,'player':1,'weapons':['weapon_c4']},
              {'tick':230,'player':0,'weapons':[]}]
    out=infer_bomb_inventory_events(loadouts,rounds,recorded,[])
    assert not any(e['source']=='inventory' and e['tick']==230 for e in out)


def test_interpolates_actor_at_event_tick():
    frames=[[100,[[0,0,0,0,2,0,100]]],[108,[[0,80,40,0,2,0,100]]]]
    assert actor_position_at(frames,104,0)==[40,20,0]
    assert actor_position_at(frames,104,1) is None
