@echo off
setlocal EnableExtensions

rem Ensure we run from the extracted OpenReplay directory (supports UNC paths).
pushd "%~dp0" >nul 2>&1
if errorlevel 1 goto bad_location

rem Guard against running directly from inside an unextracted ZIP in Explorer.
if not exist "server.py" goto incomplete_extract
if not exist "requirements.txt" goto incomplete_extract
if not exist "static\index.html" goto incomplete_extract

rem OpenReplay local: compatible Python (64-bit CPython 3.11, 3.12 or 3.13).
rem Python 3.14+ cannot install every pinned binary dependency in this release.
set "OPENREPLAY_MODE=local"
set "PYTHONUTF8=1"
set "PYTHON_KIND="
set "PYTHON_ARG="
set "VENV_CHECK=import sys, struct, pip; assert sys.implementation.name == 'cpython' and sys.version_info[:2] in ((3,11),(3,12),(3,13)) and struct.calcsize('P') == 8"
set "HOST_CHECK=import sys, struct, venv, ensurepip; assert sys.implementation.name == 'cpython' and sys.version_info[:2] in ((3,11),(3,12),(3,13)) and struct.calcsize('P') == 8"
set "IMPORT_CHECK=import fastapi, uvicorn, multipart, pandas, numpy, demoparser2"

rem Fast path: reuse an existing valid .venv without probing system interpreters.
if not exist ".venv\Scripts\python.exe" goto discover_for_new_venv
".venv\Scripts\python.exe" -c "%VENV_CHECK%" >nul 2>&1
if not errorlevel 1 goto venv_ready

echo Existing .venv is incomplete or uses an unsupported Python version.
call :find_python
if not defined PYTHON_KIND goto incompatible_venv
echo Rebuilding .venv with a compatible 64-bit Python interpreter...
rmdir /s /q ".venv" >nul 2>&1
if exist ".venv\Scripts\python.exe" goto venv_in_use
goto create_venv

:discover_for_new_venv
call :find_python
if not defined PYTHON_KIND goto missing_python

:create_venv
if "%PYTHON_KIND%"=="py" goto create_venv_py
echo Creating OpenReplay environment with "%PYTHON_ARG%" ...
"%PYTHON_ARG%" -m venv .venv
if errorlevel 1 goto venv_failed
goto venv_ready

:create_venv_py
echo Creating OpenReplay environment with py %PYTHON_ARG% ...
py %PYTHON_ARG% -m venv .venv
if errorlevel 1 goto venv_failed

:venv_ready
set "PYTHON=.venv\Scripts\python.exe"
"%PYTHON%" -c "import sys; print('OpenReplay Python', sys.version.split()[0])"
if errorlevel 1 goto venv_failed
if not exist ".venv\.openreplay-requirements.txt" goto install
fc /b "requirements.txt" ".venv\.openreplay-requirements.txt" >nul 2>&1
if errorlevel 1 goto install
"%PYTHON%" -c "%IMPORT_CHECK%" >nul 2>&1
if errorlevel 1 goto install
goto run

:install
echo Installing the pinned OpenReplay packages for the compatible Python interpreter...
rem Best-effort pip upgrade for modern wheel metadata (PEP 639) and Windows SSL truststore.
"%PYTHON%" -m pip install --disable-pip-version-check --only-binary=:all: --upgrade pip >nul 2>&1
"%PYTHON%" -m pip install --disable-pip-version-check --only-binary=:all: -r requirements.txt
if errorlevel 1 goto install_failed
"%PYTHON%" -m pip check
if errorlevel 1 goto install_failed
"%PYTHON%" -c "%IMPORT_CHECK%"
if errorlevel 1 goto import_failed
copy /y "requirements.txt" ".venv\.openreplay-requirements.txt" >nul
if errorlevel 1 goto venv_failed
goto run

:run
echo Starting OpenReplay locally...
echo Keep this window open while reviewing demos. Press Ctrl+C to stop.
"%PYTHON%" server.py
set "EXIT_CODE=%errorlevel%"
if "%EXIT_CODE%"=="0" goto finish
if "%EXIT_CODE%"=="-1073741510" goto finish
echo.
echo ERROR: OpenReplay stopped unexpectedly (exit code %EXIT_CODE%).
:finish
pause
popd >nul 2>&1
exit /b %EXIT_CODE%

:find_python
set "PYTHON_KIND="
set "PYTHON_ARG="
where py >nul 2>&1
if errorlevel 1 goto find_python_path
for %%V in (-3.13-64 -3.13 -3.12-64 -3.12 -3.11-64 -3.11) do call :try_py %%V
if defined PYTHON_KIND exit /b 0

:find_python_path
for /f "delims=" %%P in ('where python 2^>nul') do call :try_exe "%%~fP"
exit /b 0

:try_py
if defined PYTHON_KIND exit /b 0
py %1 -c "%HOST_CHECK%" >nul 2>&1
if errorlevel 1 exit /b 0
set "PYTHON_KIND=py"
set "PYTHON_ARG=%1"
exit /b 0

:try_exe
if defined PYTHON_KIND exit /b 0
if "%~1"=="" exit /b 0
if not exist "%~1" exit /b 0
"%~1" -c "%HOST_CHECK%" >nul 2>&1
if errorlevel 1 exit /b 0
set "PYTHON_KIND=exe"
set "PYTHON_ARG=%~1"
exit /b 0

:show_detected_python
where py >nul 2>&1
if errorlevel 1 goto show_detected_path
py -3 -c "import sys, struct; print('Detected Python:', sys.version.split()[0], '64-bit' if struct.calcsize('P')==8 else '32-bit', sys.implementation.name)" 2>nul
if not errorlevel 1 exit /b 0
:show_detected_path
where python >nul 2>&1
if errorlevel 1 exit /b 0
python -c "import sys, struct; print('Detected Python:', sys.version.split()[0], '64-bit' if struct.calcsize('P')==8 else '32-bit', sys.implementation.name)" 2>nul
exit /b 0

:bad_location
echo.
echo ERROR: Could not switch to the OpenReplay application directory.
echo Extract OpenReplay to a local writable folder (such as Desktop\OpenReplay) and try again.
pause
exit /b 1

:incomplete_extract
echo.
echo ERROR: Required OpenReplay files (server.py, requirements.txt, static\index.html) are missing.
echo Do not run start_windows.bat from inside a ZIP archive.
echo Extract the entire ZIP folder first (for example, to Desktop\OpenReplay),
echo then double-click start_windows.bat inside the extracted folder.
pause
popd >nul 2>&1
exit /b 1

:venv_in_use
echo.
echo ERROR: Could not replace the existing .venv folder because it is currently in use.
echo Close any running OpenReplay windows or Python processes, then launch start_windows.bat again.
pause
popd >nul 2>&1
exit /b 1

:incompatible_venv
echo.
echo ERROR: The existing .venv is broken or uses an incompatible Python, and no
echo compatible 64-bit CPython 3.11, 3.12 or 3.13 installation was found to rebuild it.
call :show_detected_python
echo.
echo Install 64-bit Python 3.13 from https://www.python.org/downloads/windows/
echo Then double-click start_windows.bat again (it will automatically rebuild .venv).
pause
popd >nul 2>&1
exit /b 1

:missing_python
echo.
echo ERROR: No compatible 64-bit Python installation was found.
echo OpenReplay requires 64-bit CPython 3.11, 3.12 or 3.13 for this release.
call :show_detected_python
echo.
echo Install Python 3.13 (64-bit) from https://www.python.org/downloads/windows/
echo (Python 3.14+ and 32-bit builds are not supported by the pinned binary wheels.)
echo Then double-click start_windows.bat again.
pause
popd >nul 2>&1
exit /b 1

:venv_failed
echo.
echo ERROR: Could not create or write to the Python virtual environment (.venv).
echo Make sure the OpenReplay folder is extracted to a writable location (not Program Files or a ZIP)
echo and that your Python installation includes the standard venv and ensurepip modules.
pause
popd >nul 2>&1
exit /b 1

:install_failed
echo.
echo ERROR: Dependency installation failed.
echo Verify your internet connection and that this is a 64-bit Python 3.11/3.12/3.13 environment.
echo If an older environment is present, close this window, delete the .venv folder, and launch again.
pause
popd >nul 2>&1
exit /b 1

:import_failed
echo.
echo ERROR: Packages installed, but a required native module failed to load.
echo On clean Windows installations, install the Microsoft Visual C++ 2015-2022 Redistributable (x64):
echo   https://aka.ms/vs/17/release/vc_redist.x64.exe
echo Also check that antivirus software did not quarantine files inside .venv.
pause
popd >nul 2>&1
exit /b 1
