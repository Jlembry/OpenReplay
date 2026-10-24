from parser import build_kills, build_utility, build_blinds

ROUNDS=[{'number':1,'start':100,'end':600,'stop':650,'freeze':140,'winner':'CT'}]
IDS={'76561190000000001':0,'76561190000000002':1}


def test_exact_kill_tick_positions_and_assist():
    kills=build_kills([{'tick':333,'user_steamid':76561190000000002,
        'attacker_steamid':76561190000000001,'assister_steamid':76561190000000002,
        'attacker_X':42,'attacker_Y':90,'user_X':65,'user_Y':110,
        'headshot':True,'weapon':'awp'}],ROUNDS,IDS)
    assert len(kills)==1
    k=kills[0]
    assert k['tick']==333 and k['killer']==0 and k['victim']==1
    assert k['killer_pos']==[42.0,90.0,0] and k['victim_pos']==[65.0,110.0,0]
    assert k['headshot'] and k['assister']==1


def test_utility_duration_damage_and_blind():
    ev={
      'smokegrenade_detonate':[{'tick':180,'entityid':12,'x':20,'y':40,'user_steamid':76561190000000001}],
      'smokegrenade_expired':[{'tick':500,'entityid':12,'x':20,'y':40}],
      'hegrenade_detonate':[{'tick':260,'x':40,'y':20,'user_steamid':76561190000000001}],
      'flashbang_detonate':[{'tick':220,'x':30,'y':40,'user_steamid':76561190000000001}],
      'inferno_startburn':[{'tick':310,'entityid':21,'x':10,'y':30}],
    }
    hurts=[{'tick':261,'weapon':'hegrenade','dmg_health':31,
            'user_steamid':76561190000000002,'attacker_steamid':76561190000000001,
            'user_X':80,'user_Y':85}]
    blinds=[{'tick':221,'player':1,'thrower':0,'duration':1.8}]
    utilities=build_utility(ev,ROUNDS,IDS,hurts,blinds)
    sm=next(x for x in utilities if x['type']=='smoke')
    assert sm['start']==180 and sm['end']==500 and not sm['estimated_end']
    he=next(x for x in utilities if x['type']=='he')
    assert he['victims'][0]['damage']==31
    flash=next(x for x in utilities if x['type']=='flash')
    assert flash['victims'][0]['duration']==1.8
    fire=next(x for x in utilities if x['type']=='fire')
    assert fire['estimated_end']


def test_blind_duration_from_position_samples():
    sample=[[225,[[1,0,0,0,3,2,100,None,None,None,None,None,600,2.4]]]]
    result=build_blinds([{'tick':221,'user_steamid':76561190000000002}],IDS,
                        sample,[225])
    assert result[0]['player']==1
    assert result[0]['duration']==2.4
