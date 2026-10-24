"""v14: round outcome fallback, no invented elimination, round badges."""
from parser import infer_elimination_rounds


def test_exact_deaths_can_recover_elimination_without_reason():
    rounds = [{'start':100,'end':900,'winner':'CT','win_type':'other'}]
    frames = [[110,[[0,0,0,0,3],[1,0,0,0,3],[2,0,0,0,2],[3,0,0,0,2]]]]
    kills = [{'tick':500,'victim':2},{'tick':700,'victim':3}]
    assert infer_elimination_rounds(rounds,frames,kills)[0]['win_type']=='elimination'


def test_not_every_opponent_died_is_not_elimination():
    rounds = [{'start':100,'end':900,'winner':'CT','win_type':'other'}]
    frames = [[110,[[0,0,0,0,3],[1,0,0,0,3],[2,0,0,0,2],[3,0,0,0,2]]]]
    assert infer_elimination_rounds(rounds,frames,[{'tick':500,'victim':2}])[0]['win_type']=='other'


def test_explosion_priority_over_kills():
    rounds = [{'start':100,'end':900,'winner':'T','win_type':'explosion'}]
    frames = [[110,[[0,0,0,0,3],[1,0,0,0,3],[2,0,0,0,2],[3,0,0,0,2]]]]
    kills = [{'tick':500,'victim':0},{'tick':700,'victim':1}]
    assert infer_elimination_rounds(rounds,frames,kills)[0]['win_type']=='explosion'
