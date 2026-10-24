"""v11 killfeed attribution and bomb position regressions."""
from parser import build_kills, build_bomb_events


ROUNDS=[{'start':100,'stop':900}]
INDEX={'123':0,'456':1,'789':2}


def test_flash_assist_is_only_game_awarded():
    rows=[{'tick':200,'attacker_steamid':123,'user_steamid':456,'assister_steamid':789,
           'weapon':'awp','assistedflash':1,'headshot':1},
          {'tick':300,'attacker_steamid':123,'user_steamid':456,'assister_steamid':789,
           'assistedflash':0,'weapon':'ak47'},
          {'tick':400,'attacker_steamid':123,'user_steamid':456,'assistedflash':1}]
    out=build_kills(rows,ROUNDS,INDEX)
    assert out[0]['flash_assist'] and out[0]['assister']==2
    assert not out[1]['flash_assist']
    assert not out[2]['flash_assist']


def test_bomb_on_ground_tracks_dropped_position():
    frames=[[200,[[0,421,322,18,2]]]]
    events={'bomb_dropped':[{'tick':205,'user_steamid':123}],
            'bomb_pickup':[{'tick':250,'user_steamid':456}],
            'bomb_planted':[{'tick':500,'user_steamid':456,'x':900,'y':200,'z':25}]}
    out=build_bomb_events(events,ROUNDS,INDEX,frames)
    assert out[0]['type']=='dropped' and out[0]['pos']==[421,322,18]
    assert out[1]['type']=='pickup' and out[1]['player']==1
    assert out[2]['type']=='planted' and out[2]['pos']==[900,200,25]
