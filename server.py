"""OpenReplay: private local viewer and anonymous web API. No sign-in required."""
from __future__ import annotations
import atexit, hashlib, hmac, json, os, re, secrets, shutil, tempfile, threading, time, uuid
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request as URLRequest, build_opener
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from security import (MODE, WEB_HOST, COOKIE, browser_allowed, csrf_value, new_session,
                      owner_hash, require_session, same_origin, session_id, set_cookie, valid_host)

BASE=Path(__file__).resolve().parent
STATIC=BASE/'static'
MAX_FILE_BYTES=int(os.getenv('OPENREPLAY_MAX_UPLOAD_MB','900'))*1024*1024
BODY_LIMIT=MAX_FILE_BYTES+1024*1024
TTL_SECONDS=int(os.getenv('OPENREPLAY_RETENTION_MINUTES','120'))*60
PARSE_TIMEOUT=int(os.getenv('OPENREPLAY_PARSE_TIMEOUT','240'))
DATA_ROOT=Path(os.getenv('OPENREPLAY_DATA_DIR','')) if os.getenv('OPENREPLAY_DATA_DIR') else Path(tempfile.mkdtemp(prefix='openreplay-'))
DATA_ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
if MODE=='local':atexit.register(lambda:shutil.rmtree(DATA_ROOT,ignore_errors=True))
MAP_DIR=Path(tempfile.gettempdir())/'openreplay-radars' if MODE=='web' else DATA_ROOT/'radars'
MAP_DIR.mkdir(parents=True,exist_ok=True,mode=0o700)
REMOTE_MANIFEST='https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/available.json'
REMOTE_BASE='https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/'
MAP_RE=re.compile(r'^[a-z][a-z0-9_]{1,55}$')
UUID_RE=re.compile(r'^[a-f0-9]{32}$')
_map_cache=None
_map_lock=threading.RLock()
_disk_lock=threading.RLock()
_pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='demo-parser') if MODE=='local' else None
_rate=defaultdict(deque)
_rate_lock=threading.RLock()

# No imported JS, no third-party trackers and no cross-origin browser connections.
CSP=("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
     "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
     "base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'")


def atomic_json(path:Path,data:dict):
    temp=path.with_name(path.name+'.tmp.'+secrets.token_hex(4))
    with temp.open('w',encoding='utf-8') as f:
        json.dump(data,f,ensure_ascii=False,allow_nan=False,separators=(',',':'))
        f.flush();os.fsync(f.fileno())
    os.replace(temp,path)


def read_job(job_id:str) -> dict | None:
    if not UUID_RE.fullmatch(job_id):return None
    try: return json.loads((DATA_ROOT/job_id/'status.json').read_text(encoding='utf-8'))
    except (OSError,ValueError):return None


def delete_old_jobs():
    now=time.time()
    with _disk_lock:
        for folder in DATA_ROOT.iterdir():
            if not folder.is_dir() or not UUID_RE.fullmatch(folder.name):continue
            job=read_job(folder.name)
            if not job or now-float(job.get('created',0))>TTL_SECONDS:
                # Don't delete a worker's current input mid-parse.
                if (folder/'running').exists() and now-float(job.get('created',0))<TTL_SECONDS+PARSE_TIMEOUT+60:continue
                shutil.rmtree(folder,ignore_errors=True)


def janitor_loop(stop:threading.Event):
    while not stop.wait(60):
        try:
            delete_old_jobs()
            with _rate_lock:
                now=time.time()
                for key,bucket in list(_rate.items()):
                    while bucket and bucket[0]<now-3600:bucket.popleft()
                    if not bucket:del _rate[key]
        except OSError:pass


@asynccontextmanager
async def lifespan(_app):
    stop=threading.Event()
    t=threading.Thread(target=janitor_loop,args=(stop,),name='replay-expiry',daemon=True)
    delete_old_jobs();t.start()
    try:yield
    finally:stop.set();t.join(timeout=2)

app=FastAPI(title='OpenReplay',docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
app.mount('/static',StaticFiles(directory=STATIC),name='static')

@app.middleware('http')
async def browser_boundaries(request:Request,call_next):
    if not valid_host(request):return JSONResponse({'detail':'Invalid host'},status_code=421)
    if not same_origin(request) or not browser_allowed(request):
        return JSONResponse({'detail':'Cross-site requests are not allowed'},status_code=403)
    if request.method not in ('GET','HEAD','POST','DELETE','OPTIONS'):
        return JSONResponse({'detail':'Method not allowed'},status_code=405)
    if request.headers.get('content-length'):
        try:
            if int(request.headers['content-length'])>BODY_LIMIT:
                return JSONResponse({'detail':'Upload too large'},status_code=413)
        except ValueError:return JSONResponse({'detail':'Bad content length'},status_code=400)
    if request.url.path.startswith('/api/demos'):
        try:request.state.sid=require_session(request,request.method in {'POST','DELETE'})
        except HTTPException as e:return JSONResponse({'detail':e.detail},status_code=e.status_code)
    response=await call_next(request)
    for key,value in {
        'Content-Security-Policy':CSP,'X-Frame-Options':'DENY',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Cross-Origin-Resource-Policy':'same-origin',
        'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
    }.items():response.headers[key]=value
    if MODE=='web':response.headers['Strict-Transport-Security']='max-age=31536000; includeSubDomains'
    if request.url.path=='/' or request.url.path.startswith('/api/') or request.url.path.endswith(('.js','.css','.html')):
        response.headers['Cache-Control']='no-store'
    return response


class BodyLimit:
    """Count actual streamed bytes, not only user-supplied Content-Length."""
    def __init__(self,inner,max_bytes):self.inner,self.max_bytes=inner,max_bytes
    async def __call__(self,scope,receive,send):
        if scope['type']!='http' or scope.get('method')!='POST':
            return await self.inner(scope,receive,send)
        total=0
        class TooLarge(Exception):pass
        async def bounded():
            nonlocal total
            message=await receive()
            if message['type']=='http.request':
                total+=len(message.get('body',b''))
                if total>self.max_bytes:raise TooLarge()
            return message
        started=False
        async def track_send(message):
            nonlocal started
            if message['type']=='http.response.start':started=True
            await send(message)
        try:await self.inner(scope,bounded,track_send)
        except TooLarge:
            if not started:
                body=b'{"detail":"Upload too large"}'
                await send({'type':'http.response.start','status':413,'headers':[(b'content-type',b'application/json'),(b'content-length',str(len(body)).encode())]})
                await send({'type':'http.response.body','body':body})


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
_opener=build_opener(NoRedirect)

def fetch_bytes(url:str,max_length:int)->bytes:
    if not (url==REMOTE_MANIFEST or url.startswith(REMOTE_BASE)):
        raise ValueError('Unexpected radar asset URL')
    req=URLRequest(url,headers={'User-Agent':'OpenReplay/secure','Accept':'application/json,image/png'})
    with _opener.open(req,timeout=10) as res:
        length=res.headers.get('Content-Length')
        if length and int(length)>max_length:raise ValueError('Oversized radar response')
        data=res.read(max_length+1)
    if len(data)>max_length:raise ValueError('Oversized radar response')
    return data


def available_maps()->dict:
    global _map_cache
    with _map_lock:
        if _map_cache is None:
            try:
                maps=json.loads(fetch_bytes(REMOTE_MANIFEST,2_000_000))['maps']
                _map_cache=maps if isinstance(maps,dict) else {}
            except (OSError,ValueError,KeyError,TypeError,HTTPError,URLError,TimeoutError):
                _map_cache={}
    return _map_cache


def map_info(map_name:str)->dict:
    if not MAP_RE.fullmatch(map_name):raise HTTPException(400,'Invalid map name')
    item=available_maps().get(map_name) or {}
    if not isinstance(item,dict):item={}
    raw=item.get('radar_info') or {};images=item.get('radar_paths') or []
    if not isinstance(raw,dict) or not isinstance(images,list):
        raw={};images=[]
    images=[i for i in images if isinstance(i,str) and len(i)<200]
    upper=next((p for p in images if '_lower_' not in p and '_v1_' not in p),None)
    lower=next((p for p in images if '_lower_' in p),None)
    if not upper:upper=next((p for p in images if '_lower_' not in p),None)
    if not (upper and {'pos_x','pos_y','scale'} <= raw.keys()):
        return {'name':map_name,'calibrated':False,'radar':False,'message':'Radar unavailable. Showing grid.'}
    vertical=raw.get('verticalsections') or {}
    return {'name':map_name,'calibrated':True,'radar':True,
            'pos_x':raw['pos_x'],'pos_y':raw['pos_y'],'scale':raw['scale'],
            'lower_z_max':(vertical.get('lower') or {}).get('AltitudeMax') if isinstance(vertical,dict) else None,
            'has_lower':bool(lower),'image':f'/api/maps/{map_name}/radar',
            'image_lower':f'/api/maps/{map_name}/radar?level=lower' if lower else None}


@app.get('/')
def index(request:Request):
    response=FileResponse(STATIC/'index.html')
    if not session_id(request.cookies.get(COOKIE)):set_cookie(response,new_session())
    return response

@app.get('/api/session')
def session_info(request:Request):
    sid=require_session(request)
    return {'csrf':csrf_value(sid),'mode':MODE,'max_upload_mb':MAX_FILE_BYTES//1048576}


def client_ip(request:Request)->str:
    # This header can only be trusted when a private reverse proxy overwrites it.
    if MODE=='web' and os.getenv('OPENREPLAY_TRUST_PROXY')=='1':
        value=request.headers.get('x-forwarded-for','').split(',')[0].strip()
        if value and len(value)<70:return value
    return request.client.host if request.client else 'unknown'


def check_upload_quota(request:Request,sid:str):
    delete_old_jobs()
    now=time.time()
    ip=client_ip(request)
    with _rate_lock:
        for kind,key,limit in [('session',sid,5 if MODE=='web' else 20),('ip',ip,30 if MODE=='web' else 100)]:
            bucket=_rate[(kind,key)]
            while bucket and bucket[0]<now-3600:bucket.popleft()
            if len(bucket)>=limit:raise HTTPException(429,'Hourly upload limit reached')
        jobs=[j for p in DATA_ROOT.iterdir() if p.is_dir() and UUID_RE.fullmatch(p.name) if (j:=read_job(p.name))]
        if len(jobs)>80:
            raise HTTPException(503,'Temporary replay storage at capacity')
        if sum((p.stat().st_size for p in DATA_ROOT.glob('*/demo.dem') if p.is_file()),0)>3*1024**3:
            raise HTTPException(503,'Temporary upload storage at capacity')
        active=[j for j in jobs if j.get('status') in {'queued','parsing'}]
        if len(active)>=(4 if MODE=='web' else 3):raise HTTPException(503,'Parser busy; try again later')
        if sum(j.get('status') in {'queued','parsing'} and j.get('owner')==owner_hash(sid) for j in jobs)>=2:
            raise HTTPException(429,'Two active uploads allowed per browser')
        for key in [('session',sid),('ip',ip)]:_rate[key].append(now)


@app.post('/api/demos',status_code=202)
async def upload_demo(request:Request,file:UploadFile=File(...)):
    sid=request.state.sid
    name=Path(file.filename or 'recording.dem').name[:140]
    if not name.lower().endswith('.dem'):raise HTTPException(400,'Please select a .dem file')
    check_upload_quota(request,sid)
    demo_id=uuid.uuid4().hex
    folder=DATA_ROOT/demo_id
    folder.mkdir(mode=0o700)
    path=folder/'demo.dem'
    uploaded=0
    try:
        with path.open('wb') as dest:
            while chunk:=await file.read(1024*1024):
                uploaded+=len(chunk)
                if uploaded>MAX_FILE_BYTES:raise HTTPException(413,'Demo too large')
                dest.write(chunk)
        with path.open('rb') as src:
            if src.read(7)!=b'PBDEMS2':raise HTTPException(400,'Not a Source 2 demo (missing PBDEMS2 header)')
        meta={'id':demo_id,'status':'queued' if MODE=='web' else 'parsing','filename':name,
              'created':time.time(),'owner':owner_hash(sid)}
        atomic_json(folder/'status.json',meta)
        if MODE=='web': (folder/'pending').touch(exist_ok=False)
        else:
            from worker import run_limited
            _pool.submit(run_limited,folder,PARSE_TIMEOUT)
        return {'id':demo_id,'status':'parsing'}
    except Exception:
        shutil.rmtree(folder,ignore_errors=True)
        raise
    finally:await file.close()


def authorized_job(request:Request,demo_id:str)->dict:
    sid=request.state.sid
    job=read_job(demo_id)
    if not job or not hmac.compare_digest(job.get('owner',''),owner_hash(sid)):
        raise HTTPException(404,'Unknown demo')
    if time.time()-job.get('created',0)>TTL_SECONDS:raise HTTPException(404,'Replay expired')
    return job

@app.get('/api/demos/{demo_id}/status')
def demo_status(request:Request,demo_id:str):
    job=authorized_job(request,demo_id)
    return {k:v for k,v in job.items() if k in {'id','status','filename','map','rounds','players','error'}}

@app.get('/api/demos/{demo_id}')
def demo_data(request:Request,demo_id:str):
    job=authorized_job(request,demo_id)
    if job['status']!='ready':raise HTTPException(409,'Demo not ready')
    path=DATA_ROOT/demo_id/'replay.json'
    if not path.is_file():raise HTTPException(404,'Replay unavailable')
    return FileResponse(path,media_type='application/json',headers={'Cache-Control':'no-store'})

@app.delete('/api/demos/{demo_id}')
def delete_demo(request:Request,demo_id:str):
    job=authorized_job(request,demo_id)
    if job['status'] in {'queued','parsing'}:raise HTTPException(409,'Cannot delete a processing demo')
    shutil.rmtree(DATA_ROOT/demo_id,ignore_errors=True)
    return {'deleted':True}

@app.get('/api/maps/{map_name}')
def metadata(map_name:str):return map_info(map_name)

@app.get('/api/maps/{map_name}/radar')
def radar(map_name:str,level:str='upper'):
    if level not in {'upper','lower'}:raise HTTPException(400,'Invalid radar level')
    info=map_info(map_name)
    if not info.get('radar') or (level=='lower' and not info.get('has_lower')):
        raise HTTPException(404,'Radar unavailable')
    path=MAP_DIR/f'{map_name}_{level}.png'
    with _map_lock:
        if not path.exists():
            images=available_maps()[map_name]['radar_paths']
            filename=next((p.rsplit('/',1)[-1] for p in images
                           if ('_lower_' in p)==(level=='lower') and '_v1_' not in p),None)
            if not filename or not re.fullmatch(r'[a-z0-9_]+\.png',filename):
                raise HTTPException(404,'Radar image unavailable')
            try:
                content=fetch_bytes(REMOTE_BASE+filename,12_000_000)
                if not content.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Invalid PNG')
                tmp=path.with_suffix('.tmp')
                tmp.write_bytes(content);os.replace(tmp,path)
            except (URLError,HTTPError,OSError,ValueError,TimeoutError):
                raise HTTPException(503,'Radar download unavailable; use grid view')
    return FileResponse(path,media_type='image/png',headers={'Cache-Control':'private,max-age=86400'})


def choose_local_port(start=8765,limit=8790):
    import socket
    for port in range(start,limit+1):
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as sock:
            try:sock.bind(('127.0.0.1',port))
            except OSError:continue
            return port
    raise RuntimeError('No available local port')

# Browser requests are streamed, including chunked uploads with no Content-Length.
application=BodyLimit(app,BODY_LIMIT)

if __name__=='__main__':
    import uvicorn,webbrowser
    if MODE!='local':raise SystemExit('Use Docker Compose for the web version')
    port=choose_local_port()
    url=f'http://127.0.0.1:{port}'
    print(f'\n  OpenReplay Local Secure -> {url}\n')
    threading.Timer(1.5,lambda:webbrowser.open(url)).start()
    uvicorn.run(application,host='127.0.0.1',port=port,access_log=False,server_header=False)
