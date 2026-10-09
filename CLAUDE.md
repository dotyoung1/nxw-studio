# Working on NXW Studio

Read this before changing anything. `README.md` covers building, testing and releasing in
more detail; this file is the short version plus the rules that keep the project working.

## What this is

A pattern-based music studio (channel rack, piano roll, playlist, mixer, browser, sampler),
shipped two ways from one interface:

- **Web version**: `web/dist/nxw-studio.html`, sound from Web Audio (`web/src/audio.js`).
- **Desktop app** (Windows/macOS, Linux for tests): the same page inside a JUCE web view, with
  a native C++ engine (`desktop/Source/engine`) that also hosts VST3 plugins.

Two people work on this repository, each with their own Claude. Neither Claude can see the
other's conversation, so anything the next person needs to know goes into the code, the
README, this file or the pull request description.

## Where things are

```
web/src/core.js        utilities, project model, undo (Hist), menus, dialogs, knobs, faders
web/src/native.js      desktop only: swaps Web Audio for the native engine (NATIVE.*)
web/src/audio.js       Web Audio engine: instruments, mixer strips, routing, scheduler
web/src/tools.js       note transforms, chord names/progressions, MIDI files, search, capture
web/src/library.js     sample library (IndexedDB), imports
web/src/export.js      WAV/MP3/stems export, file saving
web/src/shell.js       window manager, transport bar, menus, pattern/channel actions
web/src/browser.js     browser panel
web/src/rack.js        channel rack     web/src/pianoroll.js  piano roll
web/src/playlist.js    playlist         web/src/mixer.js      mixer
web/src/instrument.js  instrument window web/src/main.js       demo song, keyboard, boot
web/src/head.html      all CSS and the page markup
web/build.py           concatenates web/src (order in ORDER) into the web and desktop pages

desktop/Source/engine/Model.*        parses the project JSON into an immutable snapshot
desktop/Source/engine/Engine.*       sequencer, mixing, routing, export
desktop/Source/engine/Instruments.*  drums, NX-3 synth, sampler
desktop/Source/engine/Effects.*      built-in effects    Dsp.h  Web Audio-exact DSP pieces
desktop/Source/app/Bridge.cpp        every call from the page (`NATIVE.call('name', ...)`)
desktop/Source/plugins/              VST3 scanning (separate processes), hosting, windows
tests/                               demo.json, features.json, compare_render.py, ui_test.js
.github/workflows/build.yml          CI: builds, tests, releases
```

## Rules

1. **Sound changes go in both engines.** The project JSON is the contract. If a change affects
   what is heard (a note, clip, channel, mixer or sampler field), implement it in
   `web/src/audio.js` *and* in `desktop/Source/engine` (parse it in `Model.cpp`, use it in
   `Engine.cpp` / `Instruments.cpp` / `Effects.cpp`). Then check they still match with
   `tests/compare_render.py` (on `tests/demo.json`, and `tests/features.json` or a new test
   project that uses the feature). The engines should agree within about 1-2 dB.
2. **Old projects must keep opening.** New JSON fields are optional with a default that sounds
   exactly like before (e.g. `swing` missing means 1, `route` missing means the master).
   Never rename or remove a field.
3. **Every edit is undoable.** Change the project inside `edit(() => { ... })`, or call
   `Hist.push()` before changing it and `refresh()` / `touched()` after. Knobs use
   `onStart: () => Hist.push()` and `onEnd: touched`.
4. **The desktop page must stay pure ASCII.** `build.py desktop` escapes non-ASCII text
   automatically and fails if any is left; don't work around that check.
5. **Calls that change the engine at play time** (desktop): the page pushes the whole project
   with `NATIVE.push()` (done automatically by `touched()`). New one-off actions are a new
   `method == "..."` branch in `Bridge.cpp` plus a `NATIVE.call(...)` in the page.
6. **Keep it fast.** Canvases only redraw when `dirty`; `render()` methods skip work with
   `sigChanged()`. Don't allocate on the audio thread in C++ (pre-size vectors, use the
   message thread for anything that loads or builds).
7. **Interface text** is plain, friendly English, sentence case, no jargon where a plain word
   works. Hints (`data-hint`) say what something does and how to use it, separated by ` · `.

## Build and test (Linux, as CI does)

```bash
python3 web/build.py                     # web + desktop pages; then: node --check web/dist/app.js
cmake -S desktop -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build
APP="build/NXWStudio_artefacts/Release/NXW Studio"
"$APP" --nxw-render tests/demo.json out.wav --stems        # must print "nan 0"
"$APP" --nxw-render tests/features.json out2.wav --stems
cmake -S tests/plugins -B build-plugins -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build-plugins
scripts/ui-test.sh "$APP" build-plugins                    # interface test inside the real app
python3 tests/compare_render.py "$APP" tests/demo.json      # needs Playwright + numpy/scipy
```

The first CMake run downloads JUCE (pass `-DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE` to
reuse a copy). The Linux packages needed are listed in the `apt-get install` step of
`.github/workflows/build.yml`.

When adding a feature to the desktop app, add a check for it to `tests/ui_test.js` (it runs
inside the app on a virtual display in CI). For the web version, test the built
`web/dist/test.html` in Playwright and watch for page errors.

## How we work together

- **Start from the latest `main`** (`git pull`) before changing anything.
- **Work on a branch and open a pull request**; CI builds and tests every pull request.
  Merge only when it is green. Don't push straight to `main`.
- **Say what you are working on** in the pull request title, and avoid big rewrites of files
  the other person is likely editing at the same time.
- **Releases are done by one person**: bump `VERSION`, merge, then on GitHub
  *Actions → Build → Run workflow → Publish a release*. Installed apps offer the update
  automatically. (Pushing a `v*` tag also works where tag pushes are allowed.)
- Write commit messages and pull request descriptions for the other person: what changed,
  why, and how it was tested.

## Gotchas

- `audio.js` functions such as `play`, `stop`, `playNote`, `syncAudio`, `applySolo` are
  replaced by `NATIVE.install()` in the desktop app; the desktop engine is the one that plays.
- `A.ctx.currentTime` in the desktop app is `performance.now() / 1000`, not an audio clock.
- Pattern positions are in **steps** (16 per bar). Clip `off` is a step offset into the
  pattern; muted notes/clips (`mute: true`) are skipped by both engines.
- The mixer routing graph must stay identical in `mixGraph()` (audio.js) and
  `Model::buildMixGraph()` (Model.cpp): same validation, loop handling and solo rules.
- Linux-only JUCE patches live in `desktop/cmake/` (web view pipe, VST3 run loop); keep them
  when upgrading JUCE.
