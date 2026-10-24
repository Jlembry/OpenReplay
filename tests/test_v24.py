from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def test_fallback_team_headings_and_busted_assets():
    html=(ROOT/'static/index.html').read_text()
    source=(ROOT/'static/app.js').read_text()
    assert '>COUNTER-TERRORISTS</span>' in html
    assert '>TERRORISTS</span>' in html
    assert "recorded['3'] || 'COUNTER-TERRORISTS'" in source
    assert "recorded['2'] || 'TERRORISTS'" in source
    assert 'app.js?v=27' in html and 'styles.css?v=27' in html


def test_flash_assist_is_rendered_inside_assister_before_name():
    source=(ROOT/'static/app.js').read_text()
    start=source.index("if(k.assister!=null && k.assister!==k.killer){",source.index('function refreshLiveKillfeed()'))
    end=source.index('row.append(weaponIcon(k.weapon))',start)
    block=source[start:end]
    assert block.index("if(k.flash_assist)assist.append(killModifier('flash_assist'") < block.index('assist.append(name(k.assister')
    assert 'row.append(killModifier' not in block
