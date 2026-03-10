; ModularRandomizer Windows Installer
; Inno Setup Script — Professional VST3/Standalone installer
; Build with: ISCC.exe windows.iss

#define PluginName    "ModularRandomizer"
#define PluginVersion "1.0.0"
#define Publisher     "Dimitar Petrov"
#define PublisherURL  "https://dimitarp.com"

; These paths are relative to the .iss file location
; Override via /D on command line for CI builds:
;   ISCC.exe /DBuildDir="..\..\..\build" windows.iss
#ifndef BuildDir
  #define BuildDir     "..\..\..\build"
#endif

[Setup]
AppId={{F3A8C1D2-7B4E-4F5A-9C6D-8E2F1A3B5C7D}
AppName={#PluginName}
AppVersion={#PluginVersion}
AppPublisher={#Publisher}
AppPublisherURL={#PublisherURL}
DefaultDirName={autopf}\{#Publisher}\{#PluginName}
DefaultGroupName={#Publisher}\{#PluginName}
OutputBaseFilename={#PluginName}-{#PluginVersion}-Windows-Setup
OutputDir=..\dist
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
LicenseFile=LICENSE.txt
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#PluginName}.exe
DisableProgramGroupPage=yes
DisableDirPage=no
MinVersion=10.0

[Types]
Name: "full";      Description: "Full installation (VST3 + Standalone)"
Name: "vst3only";  Description: "VST3 plugin only"
Name: "custom";    Description: "Custom installation"; Flags: iscustom

[Components]
Name: "vst3";       Description: "VST3 Plugin";     Types: full vst3only custom; Flags: fixed
Name: "standalone"; Description: "Standalone App";   Types: full custom

[Files]
; VST3 plugin — always installed to Common Files\VST3
Source: "{#BuildDir}\plugins\ModularRandomizer\ModularRandomizer_artefacts\Release\VST3\ModularRandomizer.vst3\*"; \
  DestDir: "{commoncf64}\VST3\ModularRandomizer.vst3"; \
  Components: vst3; Flags: ignoreversion recursesubdirs createallsubdirs

; Standalone app — installed to user-chosen directory
Source: "{#BuildDir}\plugins\ModularRandomizer\ModularRandomizer_artefacts\Release\Standalone\ModularRandomizer.exe"; \
  DestDir: "{app}"; \
  Components: standalone; Flags: ignoreversion

[Icons]
; Start Menu shortcut for standalone
Name: "{group}\{#PluginName}"; \
  Filename: "{app}\{#PluginName}.exe"; \
  Components: standalone

; Desktop shortcut (optional)
Name: "{autodesktop}\{#PluginName}"; \
  Filename: "{app}\{#PluginName}.exe"; \
  Components: standalone; \
  Tasks: desktopicon

[Tasks]
Name: "desktopicon"; \
  Description: "Create a desktop shortcut"; \
  Components: standalone; \
  Flags: unchecked

[Run]
; Launch standalone after install (optional)
Filename: "{app}\{#PluginName}.exe"; \
  Description: "Launch {#PluginName}"; \
  Components: standalone; \
  Flags: nowait postinstall skipifsilent unchecked

[UninstallDelete]
; Clean up the VST3 folder on uninstall
Type: filesandordirs; Name: "{commoncf64}\VST3\ModularRandomizer.vst3"

[Messages]
BeveledLabel={#PluginName} v{#PluginVersion} — {#Publisher}

[Code]
// Show VST3 install location in the finish page
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    WizardForm.RunList.Visible := True;
  end;
end;
