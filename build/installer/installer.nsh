; ============================================================
; Reimagined Launcher - custom branded installer & uninstaller
; v1.0.88 - included by electron-builder (nsis.include)
; ============================================================
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; ---- shared state vars (declared in both builds) -----------
!ifndef BUILD_UNINSTALLER
  Var OptionsDesktop
  Var OptionsStartMenu
  Var OptionsLaunch
!else
  Var un_RemoveAll
!endif

; ---- branding (applies to the default MUI pages) -----------
!define MUI_WELCOMEPAGE_TITLE "Welcome to Reimagined"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install Reimagined - your fast, private Minecraft launcher.$\r$\n$\r$\nIt ships with the FPS Boost mod, smart performance tuning, Modrinth and CurseForge support, and a clean modern interface - all in one app.$\r$\n$\r$\nClick Next to continue."
!define MUI_ABORTWARNING "Setup is not finished. Are you sure you want to cancel?"

; ============================================================
; INSTALLER
; ============================================================
!ifndef BUILD_UNINSTALLER

; v1.0.90 — the branded splash was REMOVED entirely: the splash plugin hangs
; the installer on this NSIS build (both interactive and silent runs), which
; is exactly why silent updates never applied. The custom wizard pages below
; (options + finish) keep the branded installer experience.
; v1.0.91 — to upgrade, electron-builder runs the OLD uninstaller first
; (uninstallOldVersion). Uninstallers shipped by v1.0.88/v1.0.89 carried a
; custom "app running?" check with no silent-mode guard, which made updates
; from those versions fail/abort. Deleting the stale uninstaller HERE (in
; onInit, before the install section) makes uninstallOldVersion skip it, so
; ANY old version upgrades cleanly regardless of which launcher triggered it.
; A fresh, fixed uninstaller is always written later by the install itself.
!macro customInit
  Delete "$INSTDIR\Uninstall Reimagined.exe"
!macroend

; Options page - explained checkboxes shown after the install-location page.
!macro customPageAfterChangeDir
  Page custom preOptionsPage leaveOptionsPage
!macroend

Function preOptionsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 6 100% 26u "Optional extras"
  Pop $0
  ${NSD_CreateLabel} 0 30 100% 34u "Choose what Reimagined sets up for you. Everything here can also be changed later from the launcher."
  Pop $0
  ${NSD_CreateCheckBox} 0 78 100% 24u "Create a desktop shortcut"
  Pop $OptionsDesktop
  ${NSD_CreateLabel} 22 100 100% 20u "Adds a Reimagined icon to your Desktop so you can launch it with one click."
  Pop $0
  ${NSD_CreateCheckBox} 0 128 100% 24u "Add a Start Menu entry"
  Pop $OptionsStartMenu
  ${NSD_CreateLabel} 22 150 100% 20u "Adds Reimagined to the Start Menu under its own folder."
  Pop $0
  ${NSD_CreateCheckBox} 0 178 100% 24u "Launch Reimagined after installation"
  Pop $OptionsLaunch
  ${NSD_CreateLabel} 22 200 100% 20u "Starts the launcher right away as soon as the installation finishes."
  Pop $0
  ${NSD_SetState} $OptionsDesktop 1
  ${NSD_SetState} $OptionsStartMenu 1
  ${NSD_SetState} $OptionsLaunch 1
  nsDialogs::Show
FunctionEnd

Function leaveOptionsPage
  ${NSD_GetState} $OptionsDesktop $OptionsDesktop
  ${NSD_GetState} $OptionsStartMenu $OptionsStartMenu
  ${NSD_GetState} $OptionsLaunch $OptionsLaunch
FunctionEnd

; Create the shortcuts the user asked for on the options page.
!macro customInstall
  ${If} $OptionsDesktop == 1
    CreateShortCut "$DESKTOP\Reimagined.lnk" "$INSTDIR\Reimagined.exe" ""
  ${EndIf}
  ${If} $OptionsStartMenu == 1
    CreateDirectory "$SMPROGRAMS\Reimagined"
    CreateShortCut "$SMPROGRAMS\Reimagined\Reimagined.lnk" "$INSTDIR\Reimagined.exe" ""
  ${EndIf}
!macroend

; Completion screen - confirms success and offers Launch.
!macro customFinishPage
  Page custom preFinishPage
!macroend

Function LaunchNow
  ExecShell "" "$INSTDIR\Reimagined.exe"
FunctionEnd

Function preFinishPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 10 100% 30u "Installation complete"
  Pop $0
  ${NSD_CreateLabel} 0 42 100% 42u "Reimagined has been installed. If you don't launch it now, you'll find it in your Start Menu or on your Desktop."
  Pop $0
  ${NSD_CreateButton} 24 120 160u 32u "Launch Reimagined"
  Pop $1
  ${NSD_OnClick} $1 LaunchNow
  ${If} $OptionsLaunch == 1
    Call LaunchNow
  ${EndIf}
  nsDialogs::Show
FunctionEnd

!endif ; INSTALLER

; ============================================================
; UNINSTALLER
; ============================================================
!ifdef BUILD_UNINSTALLER

; Refuse to run while the app (or a game it launched) is still open.
; v1.0.90 fix: only enforce this for INTERACTIVE manual uninstalls. Silent
; runs (the new installer invokes the OLD uninstaller with /S --updated to
; replace the app) must never refuse or abort — electron-builder's own
; CHECK_APP_RUNNING already handles killing the app during an upgrade.
!macro customUnInit
  ${IfNot} ${Silent}
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq Reimagined.exe" /NH'
    Pop $0
    Pop $1
    ${If} $0 == 0
      MessageBox MB_ICONSTOP|MB_OK "Reimagined is still running.$\r$\n$\r$\nPlease close Reimagined (and any Minecraft game launched from it) before uninstalling, then run the uninstaller again."
      Quit
    ${EndIf}
  ${EndIf}
!macroend

; First uninstaller page - the safe "application only" vs "everything" choice.
!macro customUnWelcomePage
  UninstPage custom un.PageAsk un.PageAskLeave
!macroend

Function un.PageAsk
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 6 100% 26u "Uninstall Reimagined"
  Pop $0
  ${NSD_CreateLabel} 0 32 100% 30u "What should be removed?"
  Pop $0
  ${NSD_CreateRadioButton} 20 74 100% 24u "Remove the application only"
  Pop $1
  ${NSD_CreateLabel} 34 96 100% 34u "Removes the program files but keeps your profiles, settings, skins, logs and instances - perfect if you plan to reinstall later."
  Pop $0
  ${NSD_CreateRadioButton} 20 148 100% 24u "Remove everything"
  Pop $un_RemoveAll
  ${NSD_CreateLabel} 34 170 100% 40u "Deletes Reimagined completely, including all user data, caches and registry entries. This cannot be undone."
  Pop $0
  ${NSD_SetState} $1 1
  nsDialogs::Show
FunctionEnd

Function un.PageAskLeave
  ${NSD_GetState} $un_RemoveAll $0
  ${If} $0 == 1
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "You chose to remove everything.$\r$\n$\r$\nThis permanently deletes ALL Reimagined data - profiles, settings, skins, logs, instances and caches. There is no undo.$\r$\n$\r$\nContinue?" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

; Full cleanup when "Remove everything" was chosen (runs inside the
; uninstall section, after electron-builder removed the app files).
!macro customUnInstall
  ${If} $un_RemoveAll == 1
    RMDir /r "$APPDATA\Reimagined"
    RMDir /r "$LOCALAPPDATA\Reimagined"
    Delete "$TEMP\Reimagined*"
    DeleteRegKey HKCU "Software\Reimagined"
    DeleteRegKey HKCU "Software\Reimagined Launcher"
    nsExec::ExecToLog 'schtasks /Delete /TN "Reimagined*" /F'
  ${EndIf}
!macroend

!endif ; UNINSTALLER
