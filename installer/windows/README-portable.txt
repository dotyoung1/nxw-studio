NXW Studio - portable version
=============================

Double-click "NXW Studio.exe" to start. Nothing is installed.

- Your projects are saved in Documents\NXW Studio, and your sounds, settings and
  plugin list in %APPDATA%\NXW Studio, so they are kept when you replace the exe
  with a newer one.
- The interface is drawn by Microsoft WebView2, which Windows 11 and up-to-date
  Windows 10 PCs already have. If the window stays blank, install the "Evergreen
  Bootstrapper" from https://developer.microsoft.com/microsoft-edge/webview2/
- VST3 plugins are found in C:\Program Files\Common Files\VST3. Add other folders
  under Plugin database > Plugin folders in the browser panel.
- The first time you start it, Windows SmartScreen may say "Windows protected your PC"
  because the app is not code-signed. Click "More info", then "Run anyway".
