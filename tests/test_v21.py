"""Branding asset smoke tests."""
from pathlib import Path
from PIL import Image

STATIC = Path(__file__).resolve().parents[1] / 'static'


def test_replaced_header_and_favicon_links():
    html = (STATIC / 'index.html').read_text(encoding='utf-8')
    assert '<img class="brand-logo"' in html
    assert 'alt="OpenReplay"' in html
    assert 'OPEN CS2 DEMO REVIEWER' not in html
    assert '<div class="brand-icon"' not in html
    for name in ('openreplay-wide.png', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png'):
        assert name in html
        assert (STATIC / name).is_file()


def test_logo_and_favicon_images_are_readable():
    for name in ('openreplay-wide.png', 'openreplay-square.png', 'favicon.ico', 'favicon-32.png', 'favicon-192.png', 'apple-touch-icon.png'):
        with Image.open(STATIC / name) as im:
            im.verify()
