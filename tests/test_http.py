from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from server import app

client=TestClient(app,base_url="http://127.0.0.1:8765")
client.get("/")
csrf=client.get("/api/session").json()["csrf"]

def test_initial_page():
    response=client.get('/')
    assert response.status_code==200
    assert b'OpenReplay' in response.content
    assert client.get('/static/app.js').status_code==200

def test_invalid_upload():
    response=client.post('/api/demos',headers={'X-OpenReplay-CSRF':csrf},files={'file':('bad.dem',b'not valid demo','application/octet-stream')})
    assert response.status_code==400
    assert 'PBDEMS2' in response.json()['detail']

def test_rejected_file_extension():
    response=client.post('/api/demos',headers={'X-OpenReplay-CSRF':csrf},files={'file':('bad.bz2',b'PBDEMS2\0garbage','application/octet-stream')})
    assert response.status_code==400

def test_map_rejects_path_traversal():
    assert client.get('/api/maps/bad%20name').status_code==400
    assert client.get('/api/maps/de_mirage/radar?level=bad').status_code==400
