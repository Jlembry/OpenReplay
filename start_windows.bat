@echo off
setlocal EnableExtensions
cd /d "%~dp0"
rem OpenReplay local: compatible Python (64-bit CPython 3.11, 3.12 or 3.13).
rem Python 3.14/3.15 cannot install every pinned binary dependency in this release.
set "OPENREPLAY_MODE=local"
set "PYTHON_LAUNCH="

rem Pick a supported version instead of 'py -3', which selects the newest installed.
where py >nul 2>&1
if not errorlevel 1 (
    for %%V in (3.13 3.12 3.11) do (
        if not defined PYTHON_LAUNCH (
            py -%%V -c "import sys; assert sys.implementation.name == 'cpython' and sys.maxsize > 2**32" >nul 2>&1
            if not errorlevel 1 set "PYTHON_LAUNCH=py -%%V"
        )
    )
)
if not defined PYTHON_LAUNCH (
    where python >nul 2>&1
    if not errorlevel 1 (
        python -c "import sys; assert sys.implementation.name == 'cpython' and (3,11) <= sys.version_info[:2] <= (3,13) and sys.maxsize > 2**32" >nul 2>&1
        if not errorlevel 1 set "PYTHON_LAUNCH=python"
    )
)

rem Existing virtual environments keep the interpreter they were created with.
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import sys; assert sys.implementation.name == 'cpython' and (3,11) <= sys.version_info[:2] <= (3,13) and sys.maxsize > 2**32" >nul 2>&1
    if errorlevel 1 goto incompatible_venv
) else (
    if not defined PYTHON_LAUNCH goto missing_python
    echo Creating OpenReplay environment with %PYTHON_LAUNCH% ...
    %PYTHON_LAUNCH% -m venv .venv
    if errorlevel 1 goto venv_failed
)

set "PYTHON=.venv\Scripts\python.exe"
"%PYTHON%" -c "import sys; print('OpenReplay Python', sys.version.split()[0])"
if not exist ".venv\.openreplay-requirements.txt" goto install
fc /b "requirements.txt" ".venv\.openreplay-requirements.txt" >nul 2>&1
if errorlevel 1 goto install
goto run

:install
echo Installing the pinned OpenReplay packages for the compatible Python interpreter...
"%PYTHON%" -m pip install --only-binary=:all: -r requirements.txt
if errorlevel 1 goto install_failed
"%PYTHON%" -m pip check
if errorlevel 1 goto install_failed
copy /y "requirements.txt" ".venv\.openreplay-requirements.txt" >nul
goto run

:run
echo Starting OpenReplay locally...
"%PYTHON%" server.py
pause
exit /b %errorlevel%

:incompatible_venv
echo.
echo ERROR: The existing .venv was created with an incompatible Python.
echo OpenReplay requires 64-bit CPython 3.11, 3.12 or 3.13 for this release.
echo.
echo Install Python 3.13 (64-bit), then close this window and open
echo a Command Prompt in the OpenReplay folder to run:
echo   rmdir /s /q .venv
echo Then double-click start_windows.bat again.
echo Removing .venv only deletes the generated Python environment.
pause
exit /b 1

:missing_python
echo.
echo ERROR: No compatible 64-bit Python installation was found.
echo Install Python 3.13 (64-bit) from https://www.python.org/downloads/windows/
echo Then double-click start_windows.bat again.
echo Python 3.15 is currently too new for these pinned dependencies.
pause
exit /b 1

:venv_failed
echo ERROR: Could not create the Python virtual environment.
pause
exit /b 1

:install_failed
echo.
echo ERROR: Dependency installation failed.
echo Verify your internet connection and that this is a 64-bit Python 3.11/3.12/3.13 environment.
echo If an older environment is present, close this window, run
echo   rmdir /s /q .venv
echo in the OpenReplay folder, and launch again.
pause
exit /b 1
