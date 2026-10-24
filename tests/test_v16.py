"""Retained v16 floor features; removed experimental LOS endpoints in v18."""
from fastapi.testclient import TestClient
from server import app


def test_no_legacy_los_routes():
    paths = {route.path for route in app.routes}
    assert '/api/maps/{map_name}/walls' not in paths
    assert '/api/maps/{map_name}/los' not in paths
    assert '/api/maps/{map_name}/los-status' not in paths


def test_radar_level_validation_still_works():
    result = TestClient(app,base_url='http://127.0.0.1:8765').get('/api/maps/de_nuke/radar?level=sideways')
    assert result.status_code == 400
