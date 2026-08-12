# Reimagined CurseForge proxy (backend)

Secure middleman so the Reimagined Launcher can browse CurseForge without the
API key ever touching user machines or the repository.

## Why
CurseForge's API requires an `x-api-key` header. Shipping that key inside the
launcher would let anyone extract it. Instead the key lives ONLY here, as a
server-side environment variable.

## Deploy
1. Create a CurseForge API key (console.curseforge.com).
2. Deploy this folder anywhere that runs Node 18+ (Render / Railway / Fly.io /
   a VPS). Set the env var:
   - `CF_API_KEY` = your key
   - `PORT` = optional (default 8787)
3. In the launcher: Settings -> Advanced -> "CurseForge proxy URL" -> paste
   the proxy base URL, e.g. `https://my-cf-proxy.onrender.com`.

## Share codes (v1.0.81+)
The same service hosts the launcher's online share codes, so a code generated
on one machine resolves on any other:

- `POST /api/share` — body `{ "snapshot": … }` → `{ code, expiresAt }`
  (snapshot stored for exactly 7 days, payload capped at 2 MB).
- `GET /api/share/:code` — `{ snapshot, expiresAt }` or 404/410.

Snapshots are sanitized on the way in; lookups and creations are rate-limited
per IP. Storage persists in `share-store.json` on the instance (a redeploy
starts empty — fine, codes are short-lived). No `CF_API_KEY` needed for share
routes. The launcher reuses the "CurseForge proxy URL" setting as the backend
base, so updating this service is the only deploy step.

## Security notes
- The key is never logged, never returned, and never embedded in responses.
- Only whitelisted read-only GET paths are forwarded (search, project, files,
  changelog, single file). Nothing else is exposed.
- Add HTTPS at your host (Render/Railway provide it automatically).
- Example env file (never commit a real key):
  .env.example:
    CF_API_KEY=REPLACE_ME
