# Static map files

For production parity, supply radar art and calibrated metadata on your own host:
- `maps/de_mirage.json` + `maps/de_mirage.png`
- `maps/de_nuke.json` + `maps/de_nuke.png` + `maps/de_nuke_lower.png`

Use metadata in the same format as the existing `/api/maps/{map}` response except that image URLs are provided by the static viewer itself. If maps are absent, OpenReplay uses its coordinate-grid fallback.

Verify that you have the rights to redistribute any map artwork.
