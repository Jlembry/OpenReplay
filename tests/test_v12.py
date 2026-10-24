"""v12 recorded bomb start/cancel/kit event handling."""
from parser import build_bomb_events, clamp_bomb_timer

ROUNDS = [{'start': 100, 'stop': 1000}]
INDEX = {'123': 0, '456': 1}


def test_defuse_events_preserve_player_kit_and_abort():
    events = {
        'bomb_planted': [{'tick': 200, 'x': 44, 'y': 45, 'z': 2}],
        'bomb_begindefuse': [
            {'tick': 240, 'user_steamid': 123, 'haskit': False},
            {'tick': 290, 'user_steamid': 456, 'haskit': True},
        ],
        'bomb_abortdefuse': [{'tick': 260, 'user_steamid': 123}],
        'bomb_defused': [{'tick': 450, 'user_steamid': 456}],
    }
    out = build_bomb_events(events, ROUNDS, INDEX)
    assert [e['type'] for e in out] == [
        'planted', 'defuse_start', 'defuse_abort', 'defuse_start', 'cleared'
    ]
    assert out[0]['pos'] == [44.0, 45.0, 2.0]
    assert out[1]['has_kit'] is False and out[1]['player'] == 0
    assert out[2]['player'] == 0
    assert out[3]['has_kit'] is True and out[3]['player'] == 1


def test_missing_kit_stays_unknown_not_implicitly_true():
    events = {'bomb_begindefuse': [{'tick': 240, 'user_steamid': 123}]}
    out = build_bomb_events(events, ROUNDS, INDEX)
    assert out[0]['has_kit'] is None


def test_c4_timer_defaults_to_40_and_uses_recorded_value():
    assert clamp_bomb_timer({}) == 40
    assert clamp_bomb_timer({'mp_c4timer': '35'}) == 35
    assert clamp_bomb_timer({'mp_c4timer': -99}) == 40
