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

# PyInstaller windowed/noconsole executables have no attached standard streams.
# Keep them usable for dependencies that log while the app starts or parses.
# These devnull handles are only used when the bootloader provided None.
if sys.stdin is None:
    sys.stdin = open(os.devnull, 'r', encoding='utf-8')
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w', encoding='utf-8')


def _worker_child(args: list[str]) -> int:
    # Diagnostics are opt-in for CI; normal users' replay paths and details are
    # never written to a log unless explicitly enabled by the operator.
    log_path = os.environ.get('OPENREPLAY_WORKER_DIAG_LOG', '').strip()

    def diagnose(message: str) -> None:
        if not log_path:
            return
        try:
            with open(log_path, 'a', encoding='utf-8') as out:
                out.write(message + '\n')
        except OSError:
            pass

    try:
        if len(args) != 1:
            diagnose('Invalid worker argument count')
            return 2
        folder = Path(args[0]).resolve()
        if not folder.is_dir() or not (folder / 'status.json').is_file():
            diagnose('Missing parsing job directory or status.json')
            return 2
        diagnose('Starting isolated parser child')
        from worker import single
        single(folder)
        diagnose('Parser child completed; status file updated')
        return 0
    except BaseException:
        import traceback
        diagnose('Parser child failed unexpectedly:\n' + traceback.format_exc())
        return 1


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
        # The packaged EXE has console=False. On Windows, sys.stdout and
        # sys.stderr can be None; diagnostics must not launch a GUI error box.
        # CI supplies a log path and prints its contents after the process exits.
        import contextlib
        import faulthandler
        import traceback

        report_path = os.environ.get('OPENREPLAY_SELF_TEST_LOG', '').strip()
        report = Path(report_path) if report_path else None
        with (report.open('w', encoding='utf-8') if report else contextlib.nullcontext()) as log_file:
            diagnostic_stream = log_file or sys.stderr

            def check(message: str):
                line = '[OpenReplay self-test] ' + message
                print(line, flush=True)
                if log_file is not None:
                    log_file.write(line + '\n')
                    log_file.flush()

            watchdog_started = False
            try:
                faulthandler.enable(file=diagnostic_stream)
                faulthandler.dump_traceback_later(15, repeat=True, file=diagnostic_stream)
                watchdog_started = True
                check('1/7: Starting the self-test')
                check('2/7: Importing FastAPI backend')
                from server import STATIC, application
                check('3/7: Importing replay parser')
                from parser import extract_demo
                check('4/7: Importing native demoparser2 extension')
                import demoparser2
                check('5/7: Importing parsing worker')
                from worker import run_limited
                check('6/7: GUI import deliberately excluded from headless test')
                check('7/7: Checking packaged static files and entry points')
                assert (STATIC / 'index.html').is_file(), 'Missing bundled interface'
                assert (STATIC / 'app.js').is_file(), 'Missing bundled JavaScript'
                assert (STATIC / 'styles.css').is_file(), 'Missing bundled CSS'
                assert application is not None and callable(extract_demo) and callable(run_limited)
                check('PASS: application dependencies and assets verified')
                return 0
            except BaseException:
                traceback.print_exc(file=diagnostic_stream)
                return 1
            finally:
                if watchdog_started:
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
    args = sys.argv[1:]
    try:
        raise SystemExit(_desktop_main(args))
    except Exception as exc:
        # Background CI checks and parser workers must never display a modal
        # MessageBox: the GitHub runner cannot dismiss it, causing timeouts.
        if args and args[0] in {'--self-test', '--worker-single'}:
            import traceback
            traceback.print_exc(file=sys.stderr)
            raise SystemExit(1)
        _error_box('OpenReplay could not start.\n\n' + str(exc))
        raise SystemExit(1)
