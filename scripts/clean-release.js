/**
 * Clean Release script.
 *
 * Wipes every user-generated / private artifact so the project can be pushed
 * to the public GitHub repository safely:
 *   - data/*  (profiles, accounts, tokens, logs, games, caches, share codes)
 *             EXCEPT data/bundled/ (shipped Reimagined Client assets)
 *   - build output (out/, dist/, release/)
 *   - logs, temp files, crash dumps
 *
 * node_modules is left in place (needed to build); it is excluded from the
 * repository by .gitignore.
 *
 * Usage:  node scripts/clean-release.js
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function rm(p) {
  if (!fs.existsSync(p)) return false
  fs.rmSync(p, { recursive: true, force: true })
  return true
}

let removed = 0
const note = (p) => {
  removed++
  console.log(`  ✓ removed ${p}`)
}

console.log('Reimagined — Clean Release\n')

// 1. User data (keep the bundled client assets).
const dataDir = path.join(root, 'data')
if (fs.existsSync(dataDir)) {
  const keep = new Set(['bundled'])
  for (const entry of fs.readdirSync(dataDir)) {
    if (keep.has(entry)) continue
    if (rm(path.join(dataDir, entry))) note(`data/${entry}`)
  }
} else {
  console.log('  - data/ not present, nothing to clean')
}

// 2. Build output and generated dirs.
for (const p of ['out', 'dist', 'release', 'coverage']) {
  if (rm(path.join(root, p))) note(`${p}/`)
}

// 3. Logs / temp / dumps anywhere in the tree (bounded).
const walk = (dir, depth) => {
  if (depth > 4) return
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, depth + 1)
    else if (/\.(log|tmp|dmp|dump)$/i.test(e.name) || /crash/i.test(e.name)) {
      if (rm(full)) note(full.replace(root + path.sep, ''))
    }
  }
}
walk(root, 0)

console.log(`\nDone — ${removed} item(s) removed. The project is ready for a public push.`)
