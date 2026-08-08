// Reimagined Launcher — secure CurseForge proxy (Change 5, v1.0.36).
//
// The CurseForge API v3 key lives ONLY here as the CF_API_KEY environment
// variable — it is never shipped inside the launcher and never committed to
// the repository. The launcher talks to this proxy over HTTPS; the proxy
// talks to api.curseforge.com with the key.
//
// Deploy anywhere that runs Node (Render, Railway, Fly.io, a VPS...):
//   CF_API_KEY=your_key_here node server.js        (PORT defaults to 8787)
// Then paste `https://your-proxy-host/` into the launcher at
// Settings -> Advanced -> CurseForge proxy URL.
const http = require('http')
const https = require('https')

const PORT = process.env.PORT || 8787
const CF_API_KEY = process.env.CF_API_KEY
if (!CF_API_KEY) {
  console.error('[cf-proxy] Missing CF_API_KEY env var — set it to your CurseForge API v3 key.')
  process.exit(1)
}

const CF_BASE = 'https://api.curseforge.com/v1'
const UA = 'ReimaginedLauncher/1.0.36 (Minecraft launcher)'

// Whitelisted routes. Query strings are forwarded for /search and /files.
const ROUTES = [
  { re: /^\/api\/cf\/search$/,            cf: (u) => '/mods/search' + u.search },
  { re: /^\/api\/cf\/project\/(\d+)$/,    cf: (u, m) => `/mods/${m[1]}` },
  { re: /^\/api\/cf\/files\/(\d+)$/,      cf: (u, m) => `/mods/${m[1]}/files` + u.search },
  { re: /^\/api\/cf\/changelog\/(\d+)\/(\d+)$/, cf: (u, m) => `/mods/${m[1]}/files/${m[2]}/changelog` },
  { re: /^\/api\/cf\/file\/(\d+)\/(\d+)$/, cf: (u, m) => `/mods/${m[1]}/files/${m[2]}` }
]

function proxy(u, m) {
  return new Promise((resolve) => {
    const cfPath = ROUTES.find((r) => r.re.test(u.pathname))
    if (!cfPath) return resolve({ status: 404, body: { error: 'Not found' } })
    const target = CF_BASE + cfPath.cf(u, cfPath.re.exec(u.pathname))
    const req = https.get(target, {
      headers: { 'x-api-key': CF_API_KEY, Accept: 'application/json', 'User-Agent': UA }
    }, (res) => {
      let raw = ''
      res.on('data', (d) => { raw += d })
      res.on('end', () => {
        let body = raw
        try { body = JSON.parse(raw) } catch { /* pass raw */ }
        resolve({ status: res.statusCode, body })
      })
    })
    req.on('error', () => resolve({ status: 502, body: { error: 'Upstream unreachable' } }))
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 504, body: { error: 'Upstream timeout' } }) })
  })
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  if (req.method !== 'GET') { res.writeHead(405).end(); return }
  const u = new URL(req.url, 'http://x')
  const m = ROUTES.find((r) => r.re.test(u.pathname))
  if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Not found' })) }
  const out = await proxy(u, m)
  res.writeHead(out.status, { 'Content-Type': 'application/json' })
  res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body))
}).listen(PORT, () => console.log(`[cf-proxy] listening on :${PORT} — key configured: ${CF_API_KEY.length > 6}`))
