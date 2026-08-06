; ============================================================
; Reimagined Launcher - self-bootstrapping branded installer
; Build: makensis -DVERSION=x.y.z installer.nsi
; ============================================================
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
!include "WinMessages.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif

!define APPNAME "Reimagined Launcher"
!define APPEXE "Reimagined.exe"
!define APPKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reimagined"
!define REPO "friendlyssmp-blip/Reimagined_Launcher"
!define LATEST_URL "https://raw.githubusercontent.com/${REPO}/main/update/latest.json"
!define RAW_BASE "https://raw.githubusercontent.com/${REPO}/main"

Name "${APPNAME} Setup"
OutFile "..\dist\Reimagined-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Reimagined"
InstallDirRegKey HKCU "${APPKEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
Icon "..\build\icon.ico"
UninstallIcon "..\build\icon.ico"
BrandingText "Reimagined Launcher"
ShowInstDetails nevershow
XPStyle on
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Reimagined Launcher"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "Reimagined Launcher Setup"
VIAddVersionKey "CompanyName" "Reimagined"
VIAddVersionKey "LegalCopyright" "Reimagined"

; ---------------- MUI ----------------
!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "assets\header.bmp"
!define MUI_HEADERIMAGE_BITMAP_NOSTRETCH
!define MUI_INSTFILESPAGE_COLORS "E9E4FF 120C28"
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose where to install Reimagined Launcher. It installs only for your user - no administrator rights are needed."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Destination folder"
!define MUI_CUSTOMFUNCTION_GUIINIT "OnMyGUIInit"

; ---------------- Pages ----------------
Page custom WelcomePageCreate WelcomePageLeave
Page custom UpdateCheckPageCreate UpdateCheckPageLeave
Page custom DownloadPageCreate DownloadPageLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
Page custom FinishPageCreate FinishPageLeave

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; declare StrFunc functions before use
${StrRep}
${StrStr}

; ---------------- Globals ----------------
Var needsDownload
Var latestVersion
Var installerPath
Var updatedFlag
Var autoFlag
Var dlOK
Var checkDone
Var dlDone
Var checkTick
Var dlTick
Var dlUrl
Var json
Var extracted
Var cmpResult
Var pageTitle
Var pageSub
Var i
Var ch
Var va
Var vb
Var sa
Var sb
Var ta
Var tb
Var la
Var lta
Var sla
Var lb
Var ltb
Var slb

Function .onInit
  ; extract branded assets to $PLUGINSDIR
  SetOutPath "$PLUGINSDIR"
  File "assets\bg.bmp"
  File "assets\bg-welcome.bmp"
  StrCpy $updatedFlag "0"
  StrCpy $autoFlag "0"
  ${GetOptions} $CMDLINE "--updated" $0
  ${IfNot} ${Errors}
    StrCpy $updatedFlag "1"
  ${EndIf}
  ${GetOptions} $CMDLINE "--auto" $0
  ${IfNot} ${Errors}
    StrCpy $autoFlag "1"
  ${EndIf}
  ; silent updates: reuse the previous install location so we replace in place
  ${If} $updatedFlag == "1"
    ReadRegStr $0 HKCU "${APPKEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $INSTDIR $0
    ${EndIf}
  ${EndIf}
  ; never replace files while the launcher is running
  nsExec::ExecToLog 'taskkill /F /IM "${APPEXE}"'
  Pop $0
FunctionEnd

; called by MUI from its own GUI init (hidden test flag: --auto)
Function OnMyGUIInit
  ${If} $autoFlag == "1"
    ${NSD_CreateTimer} AutoClick 700
  ${EndIf}
FunctionEnd

Function AutoClick
  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 != 0
    System::Call "user32::IsWindowEnabled(i $0) i .r1"
    ${If} $1 != 0
      SendMessage $0 ${BM_CLICK} 0 0
    ${EndIf}
  ${EndIf}
FunctionEnd

; -- reads latest.json into $json (CR/LF stripped) --
Function ReadJsonFile
  StrCpy $json ""
  FileOpen $0 "$PLUGINSDIR\latest.json" r
  ${If} $0 == ""
    Return
  ${EndIf}
  json_loop:
    FileRead $0 $1
    ${If} ${Errors}
      Goto json_done
    ${EndIf}
    StrCpy $json "$json$1"
    Goto json_loop
  json_done:
    FileClose $0
    ${StrRep} $json $json "$\r$\n" ""
    ${StrRep} $json $json "$\r" ""
    ${StrRep} $json $json "$\n" ""
FunctionEnd

; -- $2 points just after the opening quote; extracts until closing quote into $extracted --
Function ExtractQuotedValue
  StrCpy $extracted ""
  StrCpy $i "0"
  ${Do}
    StrCpy $ch $2 1 $i
    ${If} $ch == ""
    ${OrIf} $ch == '"'
      ${ExitDo}
    ${EndIf}
    StrCpy $extracted "$extracted$ch"
    IntOp $i $i + 1
  ${Loop}
FunctionEnd

; -- parse latest.json: sets $latestVersion, $installerPath, $needsDownload --
Function ParseLatest
  StrCpy $latestVersion ""
  StrCpy $installerPath ""
  Call ReadJsonFile
  ${StrStr} $2 $json '"version":"'
  ${If} $2 != ""
    StrCpy $2 $2 "" 11
    Call ExtractQuotedValue
    StrCpy $latestVersion $extracted
  ${EndIf}
  ${StrStr} $2 $json '"installer":"'
  ${If} $2 != ""
    StrCpy $2 $2 "" 13
    Call ExtractQuotedValue
    StrCpy $installerPath $extracted
  ${EndIf}
  Push $latestVersion
  Push "${VERSION}"
  Call CompareVersions
  ${If} $cmpResult > 0
    StrCpy $needsDownload "1"
  ${Else}
    StrCpy $needsDownload "0"
  ${EndIf}
FunctionEnd

; -- $0 = version a, $1 = version b -> $cmpResult (-1 / 0 / 1) --
Function CompareVersions
  StrCpy $cmpResult 0
  StrCpy $va $0
  StrCpy $vb $1
  cmp_loop:
    ${If} $va == ""
    ${AndIf} $vb == ""
      StrCpy $cmpResult 0
      Goto cmp_done
    ${EndIf}
    StrCpy $sa "0"
    ${If} $va != ""
      ${StrStr} $ta $va "."
      ${If} $ta == ""
        StrCpy $sa $va
        StrCpy $va ""
      ${Else}
        StrLen $la $va
        StrLen $lta $ta
        IntOp $sla $la - $lta
        StrCpy $sa $va $sla
        StrCpy $va $ta "" 1
      ${EndIf}
    ${EndIf}
    StrCpy $sb "0"
    ${If} $vb != ""
      ${StrStr} $tb $vb "."
      ${If} $tb == ""
        StrCpy $sb $vb
        StrCpy $vb ""
      ${Else}
        StrLen $lb $vb
        StrLen $ltb $tb
        IntOp $slb $lb - $ltb
        StrCpy $sb $vb $slb
        StrCpy $vb $tb "" 1
      ${EndIf}
    ${EndIf}
    IntCmp $sa $sb cmp_equal cmp_less cmp_greater
  cmp_equal:
    Goto cmp_loop
  cmp_less:
    StrCpy $cmpResult -1
    Goto cmp_done
  cmp_greater:
    StrCpy $cmpResult 1
    Goto cmp_done
  cmp_done:
FunctionEnd

; ---------------- Branded page painter ----------------
; inputs: $0 = bg image, $1 = title, $2 = subtitle, $3 = status (may be "")
Function DrawFrame
  BgImage::SetBg "$PLUGINSDIR\$0"
  BgImage::AddText "$1" 30 28 420 36 "Segoe UI" 15 1 FFFFFF
  BgImage::AddText "$2" 30 78 420 52 "Segoe UI" 10 0 CFC9E8
  ${If} $3 != ""
    BgImage::AddText "$3" 30 152 420 56 "Segoe UI" 10 0 E9E4FF
  ${EndIf}
  BgImage::Redraw
FunctionEnd

; re-draw the current page with a new status text ($3)
Function StatusRedraw
  StrCpy $0 "bg.bmp"
  StrCpy $1 $pageTitle
  StrCpy $2 $pageSub
  Call DrawFrame
FunctionEnd

; ---------------- Welcome ----------------
Function WelcomePageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  StrCpy $0 "bg-welcome.bmp"
  StrCpy $1 "Welcome to Reimagined Launcher"
  StrCpy $2 "This wizard installs Reimagined on your PC. Before installing, it checks the official repository for the newest version and downloads it automatically - so you always get the latest release."
  StrCpy $3 "Version ${VERSION}"
  Call DrawFrame
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  nsDialogs::Show
FunctionEnd

Function WelcomePageLeave
  BgImage::Destroy
FunctionEnd

; ---------------- Searching for updates ----------------
Function UpdateCheckPageCreate
  ${If} ${Silent}
  ${OrIf} $updatedFlag == "1"
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  StrCpy $pageTitle "Searching for updates"
  StrCpy $pageSub "Reimagined checks the official repository before installing so you always get the newest version. This only takes a moment."
  StrCpy $0 "bg.bmp"
  StrCpy $1 $pageTitle
  StrCpy $2 $pageSub
  StrCpy $3 "Starting..."
  Call DrawFrame
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  StrCpy $checkTick "0"
  StrCpy $checkDone "0"
  ${NSD_CreateTimer} UpdateCheckTick 250
  nsDialogs::Show
FunctionEnd

Function UpdateCheckTick
  IntOp $checkTick $checkTick + 1
  ${If} $checkTick == 2
    StrCpy $3 "Contacting the official repository..."
    Call StatusRedraw
  ${ElseIf} $checkTick == 5
    ${NSD_KillTimer} UpdateCheckTick
    StrCpy $3 "Checking version information..."
    Call StatusRedraw
    System::Call "kernel32::GetTickCount() i .r0"
    inetc::get /SILENT /TIMEOUT 20000 "${LATEST_URL}?cb=$0" "$PLUGINSDIR\latest.json"
    Pop $1
    ${If} $1 == "OK"
      Call ParseLatest
      ${If} $needsDownload == "1"
        StrCpy $3 "A new version was found: Reimagined v$latestVersion. Click Next to download it."
      ${Else}
        StrCpy $3 "You already have the latest version (v$latestVersion). Click Next to continue."
      ${EndIf}
    ${Else}
      StrCpy $3 "Could not reach the update server. The bundled version (${VERSION}) will be installed."
    ${EndIf}
    StrCpy $checkDone "1"
    Call StatusRedraw
  ${EndIf}
FunctionEnd

Function UpdateCheckPageLeave
  BgImage::Destroy
  ${If} $checkDone != "1"
    ; user clicked Next before the check finished - run it right now
    System::Call "kernel32::GetTickCount() i .r0"
    inetc::get /SILENT /TIMEOUT 20000 "${LATEST_URL}?cb=$0" "$PLUGINSDIR\latest.json"
    Pop $1
    ${If} $1 == "OK"
      Call ParseLatest
    ${EndIf}
    StrCpy $checkDone "1"
    ${If} $needsDownload == "1"
      StrCpy $3 "A new version was found: Reimagined v$latestVersion. Click Next to download it."
    ${Else}
      StrCpy $3 "You already have the latest version (v$latestVersion). Click Next to continue."
    ${EndIf}
    Call StatusRedraw
    Abort
  ${EndIf}
FunctionEnd

; ---------------- Downloading (only when a newer version exists) ----------------
Function DownloadPageCreate
  ${If} ${Silent}
  ${OrIf} $needsDownload != "1"
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  StrCpy $pageTitle "Downloading Reimagined v$latestVersion..."
  StrCpy $pageSub "The newest installer is being downloaded from the official repository. This may take a minute depending on your connection."
  StrCpy $0 "bg.bmp"
  StrCpy $1 $pageTitle
  StrCpy $2 $pageSub
  StrCpy $3 "Preparing..."
  Call DrawFrame
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  StrCpy $dlTick "0"
  StrCpy $dlDone "0"
  StrCpy $dlOK "0"
  ${NSD_CreateTimer} DownloadTick 250
  nsDialogs::Show
FunctionEnd

Function DownloadTick
  IntOp $dlTick $dlTick + 1
  ${If} $dlTick == 2
    ${NSD_KillTimer} DownloadTick
    ${If} $installerPath == ""
      StrCpy $dlUrl "${RAW_BASE}/dist/Reimagined-Setup-$latestVersion.exe"
    ${Else}
      StrCpy $dlUrl "${RAW_BASE}/$installerPath"
    ${EndIf}
    inetc::get /MODERNPOPUP /CAPTION "Downloading Reimagined v$latestVersion..." /TEXTCOLOR "FFFFFF" /BGCOLOR "241338" /RESUME /TIMEOUT 900000 "$dlUrl" "$TEMP\Reimagined-Setup-$latestVersion.exe"
    Pop $1
    StrCpy $dlDone "1"
    ${If} $1 == "OK"
      StrCpy $dlOK "1"
      StrCpy $3 "Download complete. Click Next to run the new installer."
    ${Else}
      StrCpy $dlOK "0"
      StrCpy $needsDownload "0"
      StrCpy $3 "Download failed ($1). The bundled version (${VERSION}) will be installed instead."
    ${EndIf}
    Call StatusRedraw
  ${EndIf}
FunctionEnd

Function DownloadPageLeave
  BgImage::Destroy
  ${If} $dlDone != "1"
    Abort
  ${EndIf}
  ; hand off to the freshly downloaded newest installer
  ${If} $dlOK == "1"
    ${If} $autoFlag == "1"
      ExecShell "open" "$TEMP\Reimagined-Setup-$latestVersion.exe" "--updated --auto"
    ${Else}
      ExecShell "open" "$TEMP\Reimagined-Setup-$latestVersion.exe" "--updated"
    ${EndIf}
    Quit
  ${EndIf}
FunctionEnd

; ---------------- Finish ----------------
Function FinishPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  StrCpy $pageTitle "Installation Complete"
  StrCpy $pageSub "Reimagined Launcher ${VERSION} was installed successfully. Thank you for using Reimagined!"
  StrCpy $0 "bg.bmp"
  StrCpy $1 $pageTitle
  StrCpy $2 $pageSub
  StrCpy $3 "The launcher will open when you click Finish."
  Call DrawFrame
  GetDlgItem $0 $HWNDPARENT 3
  EnableWindow $0 0
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Finish"
  nsDialogs::Show
FunctionEnd

Function FinishPageLeave
  BgImage::Destroy
  ExecShell "open" "$INSTDIR\${APPEXE}"
FunctionEnd

; ---------------- Install ----------------
Section "Install" SecInstall
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r /x "*.pdb" "..\dist\win-unpacked\*"
  WriteUninstaller "$INSTDIR\Uninstall Reimagined.exe"
  CreateDirectory "$SMPROGRAMS\Reimagined Launcher"
  CreateShortcut "$SMPROGRAMS\Reimagined Launcher\Reimagined Launcher.lnk" "$INSTDIR\${APPEXE}"
  CreateShortcut "$DESKTOP\Reimagined Launcher.lnk" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${APPKEY}" "DisplayName" "Reimagined Launcher"
  WriteRegStr HKCU "${APPKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${APPKEY}" "Publisher" "Reimagined"
  WriteRegStr HKCU "${APPKEY}" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${APPKEY}" "UninstallString" '"$INSTDIR\Uninstall Reimagined.exe"'
  WriteRegStr HKCU "${APPKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${APPKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${APPKEY}" "NoRepair" 1
SectionEnd

; after a silent update (from the launcher's own Update button) reopen the app
Function .onInstSuccess
  ${If} ${Silent}
  ${AndIf} $updatedFlag == "1"
    ExecShell "open" "$INSTDIR\${APPEXE}"
  ${EndIf}
FunctionEnd

; ---------------- Uninstall ----------------
Section "Uninstall"
  Delete "$INSTDIR\Uninstall Reimagined.exe"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Reimagined Launcher\Reimagined Launcher.lnk"
  RMDir "$SMPROGRAMS\Reimagined Launcher"
  Delete "$DESKTOP\Reimagined Launcher.lnk"
  DeleteRegKey HKCU "${APPKEY}"
SectionEnd
