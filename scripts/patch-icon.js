/**
 * afterPack hook — sets the Reimagined icon and version strings on the
 * packaged Reimagined.exe using the standalone rcedit binary.
 *
 * electron-builder normally does this via its winCodeSign toolchain, which on
 * some Windows setups fails to extract (symlink permissions, no admin). With
 * `win.signAndEditExecutable: false` the toolchain is skipped and this hook
 * applies the icon directly instead — best-effort, never fails the build.
 */
const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

exports.default = async function afterPack(context) {
  const exe = path.join(context.appOutDir, 'Reimagined.exe')
  const rcedit = path.join(__dirname, '..', 'build', 'rcedit-x64.exe')
  const icon = path.join(__dirname, '..', 'build', 'icon.ico')
  const version = context.packager.appInfo.version || '1.0.0'
  if (!fs.existsSync(exe) || !fs.existsSync(rcedit) || !fs.existsSync(icon)) {
    console.warn('[patch-icon] skipped (missing exe/rcedit/icon)')
    return
  }
  try {
    execFileSync(
      rcedit,
      [
        exe,
        '--set-icon', icon,
        '--set-version-string', 'ProductName', 'Reimagined',
        '--set-version-string', 'FileDescription', 'Reimagined Launcher',
        '--set-version-string', 'CompanyName', 'Reimagined',
        '--set-file-version', version,
        '--set-product-version', `${version}.0`
      ],
      { stdio: 'ignore' }
    )
    console.log(`[patch-icon] icon + v${version} applied to Reimagined.exe`)
  } catch (err) {
    console.warn('[patch-icon] skipped:', err.message)
  }
}
