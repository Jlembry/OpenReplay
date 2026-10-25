# OpenReplay Portable Windows App — Build & Tester Instructions

This is the **existing secure local OpenReplay** with a desktop window. It is **not** the future static GitHub Pages app. The replay UI, parser, temporary file handling and localhost API are retained.

## For testers

1. Go to **GitHub → Releases** and download `OpenReplay-Windows-x64-<version>.zip` (not *Source code (zip)*).
2. Extract the ZIP completely. **Do not run it from inside the ZIP**.
3. Open the `OpenReplay` folder and double-click **`OpenReplay.exe`**.
4. The upload prompt appears in its own window. Select a `.dem` file and use all the usual controls.
5. Close the window to shut down the local server and clear its temporary workspace.

No Python or pip required. All Python packages, the parser, and UI assets are bundled. Requires Windows 10/11 x64 and the **Microsoft Edge WebView2 Runtime**, which is already present on many Windows computers. If the runtime is missing, the app opens in your default browser instead. To enable the native window, install the official runtime: https://developer.microsoft.com/microsoft-edge/webview2/ . Radar images may still be downloaded from GitHub when first requested; they are not bundled offline.

Windows may display **SmartScreen: Unknown publisher** because the beta EXE is not code-signed. Only use a release you trust. Code-sign production releases to improve reputation; do not ask testers to disable Microsoft Defender.

This distribution is a **portable folder**, not a single standalone binary. The ZIP contains an EXE plus required `_internal` support files. Do **not** move `OpenReplay.exe` out of its folder or delete `_internal`.

## For repository owner — automatic builds on GitHub

1. Upload `desktop.py`, `desktop-requirements.txt`, `OpenReplay.spec`, the updated `server.py` and `worker.py`, and `.github/workflows/build-windows-app.yml` to your repository **at the root paths shown**. Leave `static/` as a complete folder.
2. Open **GitHub → Actions → Build OpenReplay Windows App → Run workflow**.
3. Enter a beta version such as `v1.0.0-beta.2`. Leave `publish_release` **false** for the first build.
4. After the workflow completes, download the **OpenReplay-Windows-x64** artifact to obtain the ZIP and checksum. Extract and test it yourself on a clean Windows machine.
5. After successful testing, run the workflow again with `publish_release` enabled, or upload the resulting ZIP manually to **GitHub → Releases → Draft a new release**.
6. Send testers the **Release ZIP** link, rather than the GitHub **Code → Download ZIP** link.

GitHub Actions uses Windows x64 and Python 3.13 to build the EXE with PyInstaller; the tester does not need Python. The workflow checks imports/static assets and confirms that a malformed demo is rejected and cleaned up by the packaged worker. This is not a full real-demo GUI test; validate with actual demos before wide distribution.

## For developers — build on Windows

```powershell
py -3.13 -m venv .build-venv
.\.build-venv\Scripts\python.exe -m pip install -r requirements.txt -r desktop-requirements.txt
.\.build-venv\Scripts\python.exe -m PyInstaller --clean --noconfirm OpenReplay.spec
.\dist\OpenReplay\OpenReplay.exe --self-test
```

The resulting portable application is under `dist/OpenReplay/`. Zip the **entire** directory. Windows Python 3.13 x64 is only required on the build machine.

## Native window and fallback

The default entry point displays the unchanged browser-based UI in a dedicated desktop window using Windows WebView2. No external browser tab is opened. It still runs a server bound to `127.0.0.1`, and the demo is handled locally (it is **not** uploaded to a central server).

If the WebView2 native window cannot start, OpenReplay automatically opens in your default browser as a fallback. You may also use `--browser` manually. The launcher's message window must remain open while in browser mode. `--self-test` checks basic packaging, not actual replay operation.

## Security notes

- Parsing untrusted `.dem` recordings still involves native code. Packaging into an EXE **does not sandbox the parser** or eliminate vulnerabilities.
- The parsing child is time-limited and the application uses the security controls from the existing hardened local build.
- Avoid running unknown beta packages with administrator rights. The project should never require admin permissions.
- The EXE is unsigned until you configure code signing. Reproducible build verification and malware scanning of the completed artifact are recommended before releases.
- Third-party JavaScript trackers are not required or added by this packaging.
