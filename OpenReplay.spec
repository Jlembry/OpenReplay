# -*- mode: python ; coding: utf-8 -*-
"""Build with: python -m PyInstaller --clean --noconfirm OpenReplay.spec"""
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH)
all_datas = [(str(ROOT / 'static'), 'static')]
all_binaries = []
all_hidden = ['worker', 'parser', 'server', 'security', 'demoparser2']

# demoparser2 contains a platform-specific native extension; pywebview contains
# .NET interop DLLs; uvicorn imports protocol implementations dynamically.
for package in ('webview',):
    datas, binaries, hidden = collect_all(package)
    all_datas += datas
    all_binaries += binaries
    all_hidden += hidden
all_hidden += collect_submodules('uvicorn')

a = Analysis(
    [str(ROOT / 'desktop.py')],
    pathex=[str(ROOT)],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=sorted(set(all_hidden)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True,
    name='OpenReplay',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(ROOT / 'static' / 'favicon.ico'),
)
coll = COLLECT(
    exe, a.binaries, a.datas,
    strip=False, upx=False, upx_exclude=[],
    name='OpenReplay',
)
