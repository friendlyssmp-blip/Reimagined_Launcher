# Security - Reimagined Launcher

## Reporting a vulnerability

If you find a security issue, do NOT open a public issue. Report it privately:

- Open a GitHub Security Advisory in the repo:
  https://github.com/friendlyssmp-blip/Reimagined_Launcher/security/advisories/new
- Or open an Issue marked `security` and tag the maintainers.

## How the launcher keeps your data safe

### Microsoft login
- The launcher uses the **official OAuth 2.0 device-code flow** against Microsoft Entra ID.
- Your password is **never handled by the launcher** - you approve the login on the official Microsoft page (`microsoft.com/link`).
- Only endpoints are contacted: `login.microsoftonline.com`, `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com`, `api.minecraftservices.com`. No third-party or custom servers.

### Token storage
- OAuth tokens are stored **encrypted** with Windows DPAPI (Electron `safeStorage`), tied to your Windows user.
- Tokens never leave your PC except to Microsoft/Minecraft official endpoints for refresh.
- The `data/` folder (accounts, settings, logs, profiles) is **excluded from the repository** via `.gitignore`. See `PUBLISHING.md`.

### Installer integrity
- The official installer SHA-256 is published in `dist/SHA256SUMS.txt` and in the README. Users should verify their download before running it (see `TUTORIAL.md`).
- The installer is **unsigned** - Windows SmartScreen shows a warning. This is not a security defect, but users should only download from the official repository and verify the checksum.

## What the launcher does NOT do
- No telemetry, no analytics, no tracking.
- No data sent to third parties.
- No hidden installs of third-party mods (the Reimagined Client optimization layer is first-party code).

## Recommended hardening for users
- Enable **2FA** on your Microsoft account.
- Only download the installer from the official repository.
- Verify the SHA-256 checksum before executing.
- Review your Microsoft sign-in activity periodically (account.microsoft.com -> Security).
