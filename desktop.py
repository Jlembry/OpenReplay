"""OpenReplay desktop entry point.

The existing localhost HTTP API and replay interface remain unchanged.
The same EXE handles native-window mode and a restricted parsing child.
"""
from __future__ import annotations
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path


def _worker_child(args: list[str]) -> int:
    if len(args) != 1:
        return 2
    from worker import single
    folder = Path(args[0]).resolve()
    if not folder.is_dir() or not (folder / 'status.json').is_file():
        return 2
    single(folder)
    return 0


def _start_backend():
    import uvicorn
    from server import application, choose_local_port
    port = choose_local_port()
    config = uvicorn.Config(application, host='127.0.0.1', port=port,
                            log_level='warning', access_log=False, server_header=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name='openreplay-backend', daemon=True)
    thread.start()
    # Do not open the app until the HTTP server is actually listening.
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if server.started:
            return server, thread, f'http://127.0.0.1:{port}'
        if not thread.is_alive():
            break
        time.sleep(0.05)
    server.should_exit = True
    thread.join(timeout=3)
    raise RuntimeError('The local OpenReplay server did not start.')


def _message_box(message: str, icon: int = 0x40):
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, 'OpenReplay', icon)
    else:
        print(message, file=sys.stderr)

def _error_box(message: str):
    _message_box(message, 0x10)


def _desktop_main(argv: list[str]) -> int:
    if argv and argv[0] == '--worker-single':
        return _worker_child(argv[1:])
    if argv and argv[0] == '--self-test':
        # Keep every checkpoint visible in GitHub Actions even when a native
        # import stalls. Dump the Python stack instead of waiting in silence.
        import faulthandler
        faulthandler.enable()
        faulthandler.dump_traceback_later(15, repeat=True, file=sys.stderr)
        def check(message: str):
            print('[OpenReplay self-test] ' + message, flush=True)
        try:
            check('1/7: Starting the self-test')
            check('2/7: Importing FastAPI backend')
            from server import STATIC, application
            check('3/7: Importing replay parser')
            from parser import extract_demo
            check('4/7: Importing native demoparser2 extension')
            import demoparser2
            check('5/7: Importing parsing worker')
            from worker import run_limited
            check('6/7: Checking pywebview installation without starting a GUI')
            from importlib.util import find_spec
            assert find_spec('webview') is not None, 'Missing pywebview package'
            check('7/7: Checking packaged static files and entry points')
            assert (STATIC/'index.html').is_file(), 'Missing bundled interface'
            assert (STATIC/'app.js').is_file(), 'Missing bundled JavaScript'
            assert (STATIC/'styles.css').is_file(), 'Missing bundled CSS'
            assert application is not None and callable(extract_demo) and callable(run_limited)
            check('PASS: application dependencies and assets verified')
            return 0
        finally:
            faulthandler.cancel_dump_traceback_later()

    os.environ['OPENREPLAY_MODE'] = 'local'
    # This executable must never be repurposed as an internet-facing server.
    try:
        server, thread, url = _start_backend()
    except Exception as exc:
        _error_box('Could not start the local OpenReplay server.\n\n'+str(exc))
        return 1

    try:
        if '--browser' in argv:
            webbrowser.open(url)
            _message_box('OpenReplay is running in your browser.\n\n'
                       'Close this message to shut down the local server.')
        else:
            try:
                import webview
                webview.create_window('OpenReplay', url, width=1480, height=900,
                                      min_size=(900, 610), background_color='#101820')
                # Force modern Chromium so legacy IE/MSHTML is never used.
                webview.start(gui='edgechromium')
            except Exception as exc:
                # Browser fallback retains the same local API/replay capabilities.
                webbrowser.open(url)
                _message_box('The dedicated window could not start, so OpenReplay opened '
                             'in your default browser.\n\n'
                             'Install Microsoft Edge WebView2 Runtime to use the desktop window.\n\n'
                             'Close this message when you are finished to stop OpenReplay.\n\n'
                             'Details: '+str(exc))
    finally:
        server.should_exit = True
        thread.join(timeout=5)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(_desktop_main(sys.argv[1:]))
    except Exception as exc:
        _error_box('OpenReplay could not start.\n\n'+str(exc))
        raise SystemExit(1)
