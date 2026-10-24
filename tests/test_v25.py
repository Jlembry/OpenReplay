"""v25: genuine CS2 player_death flags drive killfeed modifiers."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from parser import build_kills

ROUNDS = [{'start': 100, 'end': 900, 'stop': 930}]
IDS = {'101': 0, '102': 1, '103': 2}


def test_blind_airborne_noscope_can_coexist_and_false_flags_do_not_show():
    kills = build_kills([
        {'tick': 150, 'attacker_steamid': 101, 'user_steamid': 102,
         'weapon': 'awp', 'attackerblind': True, 'attackerinair': True,
         'noscope': True, 'headshot': False},
        {'tick': 190, 'attacker_steamid': 101, 'user_steamid': 103,
         'weapon': 'ak47', 'attackerblind': False, 'attackerinair': False,
         'noscope': False},
    ], ROUNDS, IDS)
    assert [(x['attackerblind'], x['jumping'], x['noscope']) for x in kills] == [
        (True, True, True), (False, False, False)]


def test_alt_names_for_flags_and_string_false_values():
    kills = build_kills([
        {'tick': 150, 'attacker_steamid': 101, 'user_steamid': 102,
         'attacker_blind': '1', 'attacker_in_air': 1, 'no_scope': 'true'},
        {'tick': 160, 'attacker_steamid': 101, 'user_steamid': 103,
         'attacker_blind': 'false', 'attacker_in_air': 0, 'no_scope': '0'},
    ], ROUNDS, IDS)
    assert all(kills[0][key] for key in ('attackerblind','jumping','noscope'))
    assert not any(kills[1][key] for key in ('attackerblind','jumping','noscope'))


def test_v25_assets_not_cached_by_old_version():
    html = (ROOT/'static/index.html').read_text()
    server = (ROOT/'server.py').read_text()
    assert 'app.js?v=27' in html and 'styles.css?v=27' in html
    assert 'OpenReplay Local Secure' in server
