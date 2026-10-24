@echo off
setlocal
cd /d "%~dp0"
rem Private local version binds only 127.0.0.1, never all interfaces.
set "OPENREPLAY_MODE=local"
if not exist ".venv\Scripts\python.exe" (
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -m venv .venv
    ) else (
        python -m venv .venv
    )
    if errorlevel 1 (
        echo Python 3.11+ is required.
        pause
        exit /b 1
    )
)
set "PYTHON=.venv\Scripts\python.exe"
if not exist ".venv\.openreplay-requirements.txt" goto install
fc /b "requirements.txt" ".venv\.openreplay-requirements.txt" >nul 2>&1
if errorlevel 1 goto install
goto run
:install
"%PYTHON%" -m pip install --only-binary=:all: -r requirements.txt
if errorlevel 1 (
    echo Dependency installation failed. Please verify your Python version and internet connection.
    pause
    exit /b 1
)
copy /y "requirements.txt" ".venv\.openreplay-requirements.txt" >nul
:run
"%PYTHON%" server.py
pause
