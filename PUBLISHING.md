# Publishing Reimagined Launcher

This project is a **public, open-source Minecraft launcher**. Before every push
or release, make sure no private data leaks into the repository.

## Before pushing to GitHub

1. Build and verify the launcher works:

   ```bash
   npm install
   npm run typecheck
   npm run build
   ```

2. Clean every user-generated artifact (profiles, accounts, tokens, logs,
   caches, downloads, build output). **This wipes your local launcher data** —
   back up anything you want to keep first:

   ```bash
   npm run release:clean
   ```

3. Confirm nothing sensitive is staged:

   ```bash
   git status          # must show only source, assets, docs, config
   git ls-files        # double-check: no data/, no *.json with secrets
   ```

   The `.gitignore` already excludes `data/` (except `data/bundled/`),
   `node_modules/`, `out/`, `dist/`, logs, OS junk and IDE folders.

4. Commit and push to the official repository:

   ```bash
   git init
   git add .
   git commit -m "Release vX.Y.Z"
   git branch -M main
   git remote add origin https://github.com/friendlyssmp-blip/Reimagined_Launcher.git
   git push -u origin main
   ```

## Creating a release (enables in-app updates)

The launcher checks **`friendlyssmp-blip/Reimagined_Launcher`** releases on
GitHub. To ship an update to everyone:

1. Bump `"version"` in `package.json` (e.g. `1.1.0`).
2. `npm run build`
3. Create a **.zip of the whole project folder** (source code — the launcher
   rebuilds itself after applying). Exclude `node_modules/`, `data/` and `.git`
   to keep it small.
4. On GitHub → **Releases → Draft a new release**:
   - Tag/name: `v1.1.0` (must be higher than the current version)
   - Write release notes (shown in the launcher's Update dialog)
   - Attach the `.zip` as the release asset
5. Publish. Users with the launcher will get the **"Update v1.1.0"**
   notification in the sidebar within ~4 seconds of opening the app.

> The update install preserves `data/` (profiles, saves, accounts) and
> `node_modules/`, applies the new source, runs `npm install`, rebuilds and
> restarts automatically.

## Security checklist

> In development the launcher keeps its user data in `data/` inside the project
> folder (accounts are stored encrypted with Windows DPAPI via Electron
> `safeStorage`). `.gitignore` excludes `data/` entirely — only
> `data/bundled/` (shipped client assets) is tracked. Packaged builds store
> data under the OS user directory instead.

- [ ] `npm run release:clean` ran and `git status` shows no `data/`
- [ ] No `.env`, token, key or `accounts.json` files staged
- [ ] `settings.json` (with any personal config) is not in the repo
- [ ] The GitHub token was never written into any project file
