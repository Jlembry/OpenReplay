from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server import app,choose_local_port
from fastapi.testclient import TestClient


def test_fresh_index_and_js_do_not_cache():
    with TestClient(app,base_url='http://127.0.0.1:8765') as client:
        for path in ('/','/static/app.js?v=27','/static/styles.css?v=27'):
            result=client.get(path)
            assert result.status_code==200
            assert result.headers['cache-control'].startswith('no-store')


def test_quarter_speed_is_in_markup_and_before_half_speed():
    html=(ROOT/'static/index.html').read_text()
    speed=html.split('id="speedButtons"')[1].split('</div>',1)[0]
    assert speed.index('data-speed="0.25"')<speed.index('data-speed="0.5"')
    assert 'app.js?v=27' in html and 'styles.css?v=27' in html


def test_utility_labels_use_compact_radar_font():
    appjs=(ROOT/'static/app.js').read_text()
    assert "radarLabel('BLIND '+flash.toFixed(1)+'s',xy[0],xy[1]+34,'#fff5a2',true)" in appjs
    assert "radarLabel('S',p[0],p[1],'#23313a',true)" in appjs
    assert "radarLabel('D',p[0],p[1],'#d5ffe9',true)" in appjs
    assert "ctx.font=compact?'700 11px" in appjs
    assert "circleArea(u.pos,350,'#ffa96b'" in appjs
    assert "≈350" not in appjs and "~350" not in appjs


def test_team_title_replacement_and_fictional_example():
    html=(ROOT/'static/index.html').read_text()
    appjs=(ROOT/'static/app.js').read_text()
    assert '>COUNTER-TERRORISTS</span>' in html and '>TERRORISTS</span>' in html
    assert "recorded['3'] || 'COUNTER-TERRORISTS'" in appjs
    assert "recorded['2'] || 'TERRORISTS'" in appjs
    assert "SAMPLE TEAM ALPHA" in appjs and "SAMPLE TEAM BRAVO" in appjs


def test_choose_local_port_skips_busy_port():
    import socket
    with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1',0))
        first=sock.getsockname()[1]
        assert choose_local_port(first,first+4)!=first
