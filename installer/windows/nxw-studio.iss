; NXW Studio · Windows installer (Inno Setup 6)
;
; Built by the GitHub workflow:
;   ISCC /DAppVersion=0.2.0 /DSourceExe=<path>\NXW Studio.exe /DOutputDir=<folder> nxw-studio.iss
; The workflow also downloads MicrosoftEdgeWebview2Setup.exe next to this file; the installer
; runs it only on PCs that do not have the WebView2 runtime yet (Windows 10 without Edge updates).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceExe
  #define SourceExe "..\..\build\NXWStudio_artefacts\Release\NXW Studio.exe"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

[Setup]
AppId={{6F1C2B7A-4E3D-4C1B-9A57-2D8E3B9F0C41}
AppName=NXW Studio
AppVersion={#AppVersion}
AppVerName=NXW Studio {#AppVersion}
AppPublisher=NXW
DefaultDirName={autopf}\NXW Studio
DefaultGroupName=NXW Studio
DisableProgramGroupPage=yes
; Installs for everyone (asks for admin) or just this user, the user picks.
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=NXW-Studio-{#AppVersion}-Setup
SetupIconFile=..\..\desktop\Resources\icon.ico
UninstallDisplayIcon={app}\NXW Studio.exe
UninstallDisplayName=NXW Studio
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\NXW Studio"; Filename: "{app}\NXW Studio.exe"
Name: "{autodesktop}\NXW Studio"; Filename: "{app}\NXW Studio.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft WebView2 (used to draw the interface)..."; Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\NXW Studio.exe"; Description: "{cm:LaunchProgram,NXW Studio}"; Flags: nowait postinstall skipifsilent

; Projects, sounds, settings and the plugin list live in the user's AppData and Documents
; folders and are kept when NXW Studio is uninstalled or updated.

[Code]
const
  WebView2Key = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2KeyUser = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasRuntime(Root: Integer; Key: String): Boolean;
var
  V: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0');
end;

function NeedsWebView2(): Boolean;
begin
  Result := not (HasRuntime(HKLM, WebView2Key) or HasRuntime(HKCU, WebView2KeyUser));
end;
