"""Run native demo parsing outside the API process. Web worker has no network interface."""
from __future__ import annotations
import argparse, json, os, signal, subprocess, sys, time
from pathlib import Path
from parser import extract_demo


def atomic_json(path:Path, data:dict):
    temp=path.with_name(path.name+'.tmp.'+str(os.getpid()))
    with temp.open('w',encoding='utf-8') as f:
        json.dump(data,f,separators=(',',':'),ensure_ascii=False,allow_nan=False)
        f.flush();os.fsync(f.fileno())
    os.replace(temp,path)

def single(folder:Path):
    source=folder/'demo.dem'
    meta=json.loads((folder/'status.json').read_text(encoding='utf-8'))
    try:
        data=extract_demo(source,meta.get('filename','recording.dem'))
        atomic_json(folder/'replay.json',data)
        meta.update(status='ready', map=data['map'],rounds=len(data['rounds']),players=len(data['players']))
    except (Exception,MemoryError):
        meta.update(status='error',error='The recording could not be parsed.')
    finally:
        source.unlink(missing_ok=True)
        atomic_json(folder/'status.json',meta)

def run_limited(folder:Path,timeout:int=240):
    cmd=[sys.executable,__file__,'--single',str(folder)]
    opts={}
    if os.name=='posix':
        def limits():
            import resource
            # 1.9 GiB address-space limit; process-level timeout is enforced separately.
            memory_mb=int(os.getenv('OPENREPLAY_WORKER_MEMORY_MB','0'))
            if memory_mb:
                resource.setrlimit(resource.RLIMIT_AS,(memory_mb*1024**2,memory_mb*1024**2))
            resource.setrlimit(resource.RLIMIT_CPU,(max(30,timeout),max(31,timeout+1)))
            resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        opts['preexec_fn']=limits
        opts['start_new_session']=True
    proc=subprocess.Popen(cmd, stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**opts)
    try: proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name=='posix':os.killpg(proc.pid,signal.SIGKILL)
        else:proc.kill()
        proc.wait()
    meta_path=folder/'status.json'
    if meta_path.exists():
        try: meta=json.loads(meta_path.read_text(encoding='utf-8'))
        except (ValueError,OSError):meta={}
        if meta.get('status') not in {'ready','error'}:
            meta.update(status='error',error='Parsing timed out or was interrupted.')
            atomic_json(meta_path,meta)
    (folder/'demo.dem').unlink(missing_ok=True)

def loop(root:Path):
    print('OpenReplay isolated parser worker ready',flush=True)
    while True:
        try:
            for folder in sorted(root.iterdir()):
                if not folder.is_dir():continue
                pending=folder/'pending'
                try: pending.rename(folder/'running')
                except (FileNotFoundError,OSError):continue
                try:run_limited(folder,int(os.getenv('OPENREPLAY_PARSE_TIMEOUT','240')))
                finally:(folder/'running').unlink(missing_ok=True)
        except (OSError,FileNotFoundError): pass
        time.sleep(1.0)

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--single',type=Path)
    p.add_argument('--loop',type=Path)
    args=p.parse_args()
    if args.single: single(args.single)
    elif args.loop:loop(args.loop)
    else:p.error('Specify --single or --loop')
