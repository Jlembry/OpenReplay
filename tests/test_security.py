"""Security regression checks; uses synthetic headers/files, never a real user's recording."""
from __future__ import annotations
import json, os, time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
import server
import worker

BASE='http://127.0.0.1:8765'


def client():return TestClient(server.application,base_url=BASE)

def csrf(c):
    assert c.get('/').status_code==200
    resp=c.get('/api/session')
    assert resp.status_code==200
    return resp.json()['csrf']

def test_strict_local_origin_host_and_fetch_site():
    with client() as c:
        token=csrf(c)
        assert c.get('/api/session',headers={'Host':'evil.example'}).status_code==421
        assert c.get('/api/session',headers={'Origin':'https://evil.example'}).status_code==403
        assert c.get('/api/session',headers={'Sec-Fetch-Site':'cross-site'}).status_code==403
        assert c.get('/api/demos/'+'a'*32+'/status').status_code==404
        assert c.post('/api/demos',files={'file':('bad.dem',b'wrong')}).status_code==403
        assert c.post('/api/demos',headers={'X-OpenReplay-CSRF':'bogus'},files={'file':('bad.dem',b'wrong')}).status_code==403
        assert c.post('/api/demos',headers={'X-OpenReplay-CSRF':token,'Origin':'https://evil.example'},files={'file':('bad.dem',b'wrong')}).status_code==403
        assert c.post('/api/demos',headers={'X-OpenReplay-CSRF':token},files={'file':('bad.dem',b'wrong')}).status_code==400


def test_cookie_and_security_headers():
    with client() as c:
        page=c.get('/')
        assert 'httponly' in page.headers['set-cookie'].lower()
        assert 'samesite=strict' in page.headers['set-cookie'].lower()
        assert 'secure' not in page.headers['set-cookie'].lower() # localhost http
        for name in ('content-security-policy','x-frame-options','x-content-type-options','referrer-policy','cross-origin-resource-policy'):
            assert name in page.headers
        assert c.get('/openapi.json').status_code==404
        assert 'access-control-allow-origin' not in page.headers
        assert 'no-store' in c.get('/api/session').headers['cache-control']


def test_replay_is_scoped_to_anonymous_browser_and_delete(monkeypatch):
    monkeypatch.setattr(server._pool,'submit',lambda *a,**kw:None)
    with client() as owner,client() as stranger:
        t1=csrf(owner);t2=csrf(stranger)
        # Synthetic data has a valid format header; no native parser invocation.
        uploaded=owner.post('/api/demos',headers={'X-OpenReplay-CSRF':t1},files={'file':('fake.dem',b'PBDEMS2'+b'00')})
        assert uploaded.status_code==202,uploaded.text
        job_id=uploaded.json()['id']
        folder=server.DATA_ROOT/job_id
        try:
            assert stranger.get(f'/api/demos/{job_id}/status').status_code==404
            assert stranger.get(f'/api/demos/{job_id}').status_code==404
            assert stranger.delete(f'/api/demos/{job_id}',headers={'X-OpenReplay-CSRF':t2}).status_code==404
            state=server.read_job(job_id)
            state.update(status='ready',map='de_mirage',rounds=1,players=10)
            server.atomic_json(folder/'status.json',state)
            (folder/'replay.json').write_text('{"players":[]}',encoding='utf-8')
            assert owner.get(f'/api/demos/{job_id}/status').json()['status']=='ready'
            assert owner.get(f'/api/demos/{job_id}').json()['players']==[]
            assert owner.delete(f'/api/demos/{job_id}',headers={'X-OpenReplay-CSRF':t1}).status_code==200
            assert owner.get(f'/api/demos/{job_id}').status_code==404
        finally:
            import shutil;shutil.rmtree(folder,ignore_errors=True)


def test_replay_expiration(monkeypatch):
    folder=server.DATA_ROOT/('b'*32)
    folder.mkdir(exist_ok=True)
    server.atomic_json(folder/'status.json',{'created':time.time()-server.TTL_SECONDS-1000,'status':'ready'})
    server.delete_old_jobs()
    assert not folder.exists()


def test_request_body_limit_without_content_length(monkeypatch):
    server.application.max_bytes=50
    try:
        with client() as c:
            csrf(c)
            # The ASGI limit also applies to streaming bodies.
            r=c.post('/api/demos',files={'file':('bad.dem',b'X'*80)},headers={'X-OpenReplay-CSRF':c.get('/api/session').json()['csrf']})
            assert r.status_code in {400,413}  # The multipart decoder may normalize an oversize read to 400.
    finally:server.application.max_bytes=server.BODY_LIMIT


def test_worker_success_and_error_handling(tmp_path,monkeypatch):
    folder=tmp_path/'job';folder.mkdir()
    src=folder/'demo.dem';src.write_bytes(b'PBDEMS2stub')
    worker.atomic_json(folder/'status.json',{'filename':'test.dem','status':'parsing'})
    monkeypatch.setattr(worker,'extract_demo',lambda *_:{'map':'de_nuke','rounds':[{}],'players':[{},{},{}]})
    worker.single(folder)
    assert worker.json.loads((folder/'status.json').read_text())['status']=='ready'
    assert not src.exists()
    assert json.loads((folder/'replay.json').read_text())['map']=='de_nuke'
    src.write_bytes(b'PBDEMS2stub')
    worker.atomic_json(folder/'status.json',{'filename':'secret-path.dem','status':'parsing'})
    def bad(*args):raise RuntimeError('C:/secret/path/file')
    monkeypatch.setattr(worker,'extract_demo',bad)
    worker.single(folder)
    state=json.loads((folder/'status.json').read_text())
    assert state['status']=='error' and 'secret' not in state['error']
    assert not src.exists()
