# NXW Studio

A pattern-based music studio: channel rack with step sequencer, piano roll, playlist and mixer.
It runs in two forms that share the same interface code:

- **Web version**: one HTML page; sound comes from the browser's Web Audio.
- **Desktop app** (Windows, macOS): the same interface in a native window, with a native C++
  audio engine (JUCE) that also hosts **VST3 instruments and effects**, uses your audio
  interface directly (WASAPI, or ASIO if you build with the ASIO SDK), and exports
  WAV/MP3 with stems.

## Getting the desktop app

Every push to `main` builds Windows downloads in GitHub Actions:

1. Open the repository's **Actions** tab, choose the latest **Build** run.
2. Under **Artifacts**, download `NXW-Studio-<version>-Windows`. It contains
   - `NXW-Studio-<version>-Setup.exe`: the installer (Start menu entry, uninstaller,
     installs Microsoft WebView2 if the PC lacks it);
   - `NXW-Studio-<version>-Windows-portable.zip`: just the exe, no install.

Tagged versions (see *Releasing* below) appear on the **Releases** page instead, where
anyone can download them without a GitHub account.

The builds are not code-signed, so the first launch shows *"Windows protected your PC"*.
Click **More info → Run anyway**. See *Signing* below to remove that warning.

## Using plugins

On first launch the app scans the standard VST3 folder (`C:\Program Files\Common Files\VST3`
on Windows, `/Library/Audio/Plug-Ins/VST3` and `~/Library/Audio/Plug-Ins/VST3` on macOS).
Plugins appear in the browser under **Plugin database → VST3 instruments / VST3 effects**.

- Click an instrument to add it as a channel; click its name in the channel rack to open its window.
- Add an effect from the browser, or from an empty mixer slot.
- Other folders: **Plugin database → Plugin folders…** (or **File → Plugin folders…**), then scan.
- Each plugin is checked in a separate process, so a plugin that crashes during the scan is
  skipped instead of taking the studio down. **File → Rescan all plugins** retries skipped ones.
- Plugin settings are saved inside project files and in the autosave.

VST2 plugins are not supported (Steinberg no longer licenses the VST2 SDK).

## Where things are kept

| What | Windows | macOS |
|---|---|---|
| Projects (File → Save project) | `Documents\NXW Studio` | `~/Documents/NXW Studio` |
| Autosave, sounds, plugin list, settings | `%APPDATA%\NXW Studio` | `~/Library/Application Support/NXW Studio` |
| Logs | `%LOCALAPPDATA%\NXW Studio\Logs` | `~/Library/Application Support/NXW Studio/Logs` |

**Help → Show log files** opens the log folder; include `nxw.log` when reporting a problem.

## Building it yourself

Requirements: CMake 3.22+, Python 3, a C++17 compiler (Visual Studio 2022 on Windows, Xcode on
macOS). JUCE 8.0.9 is downloaded automatically.

```bash
# Windows (Developer PowerShell): WebView2 SDK once
nuget install Microsoft.Web.WebView2 -Version 1.0.1901.177 -OutputDirectory C:\nuget
cmake -S desktop -B build -G "Visual Studio 17 2022" -A x64 -DJUCE_WEBVIEW2_PACKAGE_LOCATION=C:\nuget
cmake --build build --config Release
# -> build\NXWStudio_artefacts\Release\NXW Studio.exe

# macOS
cmake -S desktop -B build -G Xcode
cmake --build build --config Release

# Linux (used for tests; needs libwebkit2gtk-4.1-dev, libasound2-dev, libcurl4-openssl-dev)
cmake -S desktop -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build
```

Options: `-DNXW_GITHUB_REPO=owner/repo` sets where *Check for updates* looks (CI sets it
automatically). `-DNXW_ASIO_SDK_DIR=path` adds ASIO drivers on Windows; the ASIO SDK comes
from Steinberg under its own licence and is not included here.

The web version: `python web/build.py browser` writes `web/dist/nxw-studio.html`.

## How it fits together

```
web/src/        the interface (HTML/CSS/JS), shared by both versions
  native.js     desktop only: talks to the native engine instead of Web Audio
web/build.py    builds the web page, and the desktop page that is embedded in the exe
desktop/Source/
  engine/       audio engine: instruments, effects, mixer, sequencer (a port of the Web Audio engine)
  plugins/      VST3 scanning (out of process), loading, plugin windows
  app/          window, web view, the bridge between interface and engine, autosave, updates
tests/          demo project, engine-vs-browser comparison, interface test, test plugins
```

The interface runs in the system web view (WebView2 on Windows, WKWebView on macOS) and sends
the project to the engine whenever it changes. The engine plays it with sample-accurate timing
and sends back the playhead, meters and scope 30 times a second. Plugin states stay on the
native side and are merged into saved project files.

## Tests

The workflow runs these on every push; locally (Linux):

```bash
"build/NXWStudio_artefacts/Release/NXW Studio" --nxw-render tests/demo.json out.wav --stems
cmake -S tests/plugins -B build-plugins -G Ninja && cmake --build build-plugins
"build/NXWStudio_artefacts/Release/NXW Studio" --nxw-plugin-selftest \
    "build-plugins/NXWTestSynth_artefacts/Release/VST3/NXW Test Synth.vst3" \
    "build-plugins/NXWTestGain_artefacts/Release/VST3/NXW Test Gain.vst3"
scripts/ui-test.sh "$PWD/build/NXWStudio_artefacts/Release/NXW Studio" build-plugins
python tests/compare_render.py "build/NXWStudio_artefacts/Release/NXW Studio"   # needs Playwright
```

`compare_render.py` renders the demo song with both engines and compares loudness over time
and tone per mixer track; they match within about 1 dB.

## Releasing an update

1. Change the number in `VERSION` (for example `0.3.0`) and commit.
2. Tag and push: `git tag v0.3.0 && git push origin v0.3.0`
3. The workflow builds Windows (and macOS) and publishes a GitHub release with the installer.

Installed copies check the latest release a few seconds after starting and offer the download;
**Help → Check for updates** does the same on demand. Installing a new version over an old one
keeps all projects, sounds and settings.

## Licensing (decide before sharing publicly)

NXW Studio's own code has no licence file yet. Two components decide what you can do:

- **JUCE** is available under the **AGPLv3** (then NXW Studio must be open source under
  AGPLv3 too, and anyone you give the app to can ask for the source) **or** a JUCE commercial
  licence. JUCE 8's free *Starter* licence covers closed-source products earning up to $20,000
  a year; above that, *Indie* or *Pro*. Details: https://juce.com/get-juce
- **VST3 SDK** (bundled with JUCE 8.0.9, version 3.7.12) is available under **GPLv3** or
  Steinberg's free VST3 licence agreement. Steinberg's newer VST 3.8 SDK is MIT-licensed.

For a free open-source project: add an AGPLv3 `LICENSE` file and keep the repository public.
For a closed-source app: register for the JUCE Starter licence and accept Steinberg's
VST3 licence agreement. Fonts (Archivo, Martian Mono, Unbounded) are under the SIL Open Font
Licence (`web/fonts`), lamejs under LGPL, JSZip under MIT.

## Signing

Unsigned apps work but show warnings: Windows SmartScreen ("More info → Run anyway") and macOS
Gatekeeper (right-click the app → Open, or allow it in System Settings → Privacy & Security).
To remove them:

- **Windows**: an OV/EV code-signing certificate (or Azure Trusted Signing), then sign
  `NXW Studio.exe` and the installer with `signtool` in the workflow.
- **macOS**: an Apple Developer account ($99/year), sign with a Developer ID certificate and
  notarize with `notarytool`.
