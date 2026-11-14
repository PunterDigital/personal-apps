# Personal Apps — Operations Playbook

This folder is the control plane for Shay's personal apps. Claude maintains every app in here
mostly unattended: onboarding new projects, triaging the GroundStation card table, building,
testing, releasing, and keeping the downloads page current. Shay is hands-off; this file is the
source of truth for *how* work is done. Update it when the process changes.

## Layout

| Path | What |
|---|---|
| `CLAUDE.md` | This playbook |
| `projects.json` | Registry: one entry per app (folder, repo, GroundStation tag, platforms) |
| `site/` + `scripts/build-site.mjs` | Downloads page source; built into `_site/` by CI |
| `.github/workflows/pages.yml` | Deploys the downloads page to GitHub Pages |
| `ops/run-log.md` | Local, gitignored log of each scheduled run (append, keep last ~50 runs) |
| `ops/permission-requests.md` | Permissions a run needed but did not have (committed) |
| `<app-folder>/` | Each app, its own git repo (gitignored by this control repo) |

- Control repo: `PunterDigital/personal-apps` (public)
- Downloads page: https://punterdigital.github.io/personal-apps/
- GroundStation project: **Personal Apps** (project_id `8`)

## Fixed facts

- **Identity.** The GroundStation connection acts as Shay. Every comment Claude writes MUST start with
  `🤖 Claude:`. Any comment *without* that prefix is Shay's. Never assign cards to Shay to mean "Claude";
  use the `claude` tag instead.
- **GitHub.** Org `PunterDigital` (free plan; Shay is admin). App repos are **public** by default (unlimited
  Actions minutes, incl. macOS runners). Licence: MIT unless the project already has one.
  Exception: Shay can keep a repo **private** (registry `private: true`, e.g. Obsidian Resource Pack
  Hosting). Never change visibility or add a licence to a private repo without asking. See
  **Private repos** under Platform notes.
- **Platforms.** Priority order: **Web**, **Windows**, **macOS**. No Linux/mobile unless a card asks,
  except native **Android** apps (e.g. World Explorer), which ship a sideloadable `.apk` per release,
  and self-hosted server apps (Arkeep), which ship Linux archives + Docker images (registry
  `downloads` list, see **Forks of upstream projects**).
- **Signing.** Builds are unsigned. The downloads page explains the SmartScreen / Gatekeeper bypass.
- **Repo owner.** App repos default to `PunterDigital`, but Shay may keep one on his personal account
  (`ShayPunter/…`). The registry `repo` field is authoritative; don't transfer without asking.
- **Machine.** Windows 11, Node 24, git, gh, PHP 8.3 (default) and 8.4 + Composer (via pvm; the
  `composer` shim always uses 8.3, so for 8.4 run `php <8.4 dir>/composer/composer.phar`), Docker. No .NET SDK.
  Cannot run macOS builds locally — macOS is verified by CI only. Android SDK (with emulator) in
  `%LOCALAPPDATA%\Android\Sdk`; JDK 21 at `C:\Program Files\Java\jdk-21.0.11` (`JAVA_HOME` points at
  Android Studio's JDK 25 JBR, which older Gradle can't run on). No Python: `python3` is the
  Windows Store stub and hangs the shell until timeout. Use Node for scripts. No Go either: run Go
  in a `golang:<version from go.work>` container with the tree piped in (Arkeep `CLAUDE.md`).

## Board (Personal Apps card table)

| Column | id | Meaning |
|---|---|---|
| Triage | 23 | New cards. Untouched by Claude until triaged |
| Not Now | 24 | Triaged as "later" — deliberately parked, with a reason comment |
| Needs Info | 25 | Waiting on Shay; questions in a comment (or the description of a Claude-created card); tagged `needs answer` |
| Ready | 26 | Triaged, clear, sized; next to be picked up |
| In Progress | 28 | Being built on a feature branch |
| Testing & CI | 29 | Built; local E2E testing and/or PR pipelines running |
| Awaiting Release | 30 | Merged to `main`; ships in the next release |
| Done | 27 | Released; final comment has version + download link |

**Shay's own tasks.** Work only Shay can do (a Forge/Documenso setting, a run that a scheduled
session isn't allowed to make) goes on a card **assigned to Shay** (member id 1), in Ready, without
the `claude` tag, with numbered steps in the description or a `🤖 Claude:` comment (Shay asked for
this on #3446, Nov 9: "make separate tickets and assign them to myself"). The build step skips
these cards. When Shay comments that it's done, check what you can and move it on.

**Tags.** Project tags (lowercase, e.g. `nexus ssh`) map to `projects.json[].tag`. Status tags Claude
manages: `claude` (Claude owns it), `needs answer` (question pending for Shay), `blocked` (Claude
cannot proceed — reason in comments), `bug`, `hotfix` (ship immediately), `size: s|m|l`,
`priority: low|medium|high|critical`. Shay's own: `upstream` (id 38) on a fork's card (Arkeep)
sends that change upstream as a PR too (see **Forks of upstream projects**).
Create tags on the fly with `add_card_tag` by name.

**Priority.** Every triaged card carries exactly one `priority:` tag:

| Tag | Meaning | Handling |
|---|---|---|
| `priority: critical` | App won't launch, data loss, security issue, production down | Built first, released straight after merge (as `hotfix`) |
| `priority: high` | Core feature broken with no workaround, or Shay wants it soon | Built before any medium/low card |
| `priority: medium` | Normal features and bugs (the default) | Normal order |
| `priority: low` | Polish, nice-to-haves, cleanup | Only when nothing higher is in Ready |

Shay's priority wins: if a card already has a `priority:` tag that Shay set, keep it. If Claude disagrees,
say why in a comment and leave the tag alone. A Ready card with no priority tag counts as medium; add
the tag the next time the card is touched. Only one `priority:` tag per card: remove the old one when changing it.

## Scheduled run procedure

Runs every 2 hours, 09:00–23:00 local, plus 00:00 (scheduled task `personal-apps-run`, cron
`0 0,9/2 * * *`). Each run:

0. **Lock.** If `ops/run.lock` exists and is < 3h old, another run is active: log and exit. Otherwise
   write the lock (timestamp) and delete it at the end, success or failure.
   An interactive session that carries on pipeline work after its run (e.g. Shay hands it a deploy
   log) writes the lock too. Without one, a run and that session both merged Panel PRs and fixed the
   same bug twice (Oct 26, #3365). So before touching a project, check for `claude/*` pushes or new
   PRs from the last hour that this run didn't make, and `list_sessions` for a running "Personal
   Apps" session in this folder; if one is running, leave that project alone this run.
   An interactive session with Shay that merges, builds or moves cards takes the lock as well:
   otherwise the next scheduled run starts the same queue in the same checkouts (Oct 26: both
   merged held Panel PRs and opened duplicate fixes, #65/#66).
1. **Sync.** `git pull` the control repo. For each project in `projects.json`, `git fetch` and make sure
   the local `main` is up to date and the working tree is clean (stash nothing silently — if dirty and
   not from an in-flight Claude branch, flag it on a card / push notification and skip that project).
2. **New folders.** Any top-level folder not in `projects.json` (ignoring `ops`, `site`, `scripts`,
   `.github`, `.claude`, `_site`, `node_modules`) → run **Onboarding** (below).
3. **In-flight work first.** Cards in *Testing & CI*: check PR checks (`gh pr checks`). Green → merge
   (squash), move to *Awaiting Release*, comment. Red → read logs, fix, push; after 3 failed fix
   attempts tag `blocked`, comment with the failure summary, leave it.
   Cards in *In Progress* left by a crashed run: resume from the branch.
4. **Answers.** For **every** card in *Needs Info*, fetch the thread (`get_card` or `list_comments`).
   Never decide from the board's `commentCount`, because it doesn't say who wrote the comments.
   Claude's questions may be in the card **description** (cards Claude created) or in a `🤖 Claude:`
   comment. Any comment **without** the `🤖 Claude:` prefix that is newer than Claude's latest
   question (the description counts as written at card creation) is Shay's answer. Remove
   `needs answer`, reply `🤖 Claude: Thanks — …` with what you'll do, and re-triage with the new info
   (usually → Ready with acceptance criteria). If unanswered for 7 days, push-notify once.
   Shay often answers while a run is going: the Oct 30 11:10 run read Needs Info at its start
   and missed three answers posted 15 minutes later. Before the report (step 8), check
   `list_activity` for comments newer than the run's start and act on them.
   Shay also comments on cards in other columns (objections on Ready cards, notes on In Progress).
   Read the full comment thread of any card before you build, merge or release it, and act on any
   un-prefixed comment newer than Claude's last one.
5. **Triage.** Every card in *Triage* (see **Triage rules**).
6. **Build.** Take the top `claude` card from *Ready* (cards assigned to Shay are his tasks): `hotfix` / `priority: critical` > `high` > `medium` >
   `low`; within the same priority, `bug` > due date > oldest. Run the
   **Feature workflow**. Do up to 2 cards per run if time allows; never leave a card half-done without
   a comment saying where it stands.
7. **Release.** Apply the **Release cadence**.
8. **Report.** Append a short entry to `ops/run-log.md`. If anything needs Shay (new questions,
   `blocked`, permission needed), send ONE push notification summarising it. Remove the lock.

## Triage rules

For each card in Triage:

1. **Project.** Identify it by project tag. No tag / unknown tag → ask which project (Needs Info).
2. **Understand.** Read title, description, comments. Look at the relevant code.
3. **Decide:**
   - **Ready** — the outcome is clear enough to write acceptance criteria. Comment with:
     `🤖 Claude: Triaged.` + acceptance criteria (bullets) + size (S ≤ 1 run, M ≤ 3 runs, L = split)
     + priority with a one-line reason
     + planned approach in 1–3 lines. Tag `claude`, `size: x` and `priority: x` (see **Priority**).
   - **Needs Info** — real ambiguity that changes what gets built. Comment with numbered questions,
     each with Claude's recommended default ("If you don't mind, I'll do X"). Tag `needs answer`.
     When Claude creates a card that needs an answer, the description holds the context and the
     questions still go in a `🤖 Claude:` comment, so each card follows one pattern.
     Do not ask questions with obvious conventional answers — pick the default and note it.
   - **Not Now** — out of scope, huge, or blocked by something external. Comment the reason.
   - **L-size** → split into S/M cards (create_card, same tags incl. priority, straight into Ready), comment on the
     parent listing them, and move the parent to Done once all pieces are released.
4. **Always ask first (Needs Info) before:** breaking changes to user data or config formats, deleting
   features, adding paid services/APIs, changing licence, anything touching credentials or secrets.
5. **Big batches** (Nov 2: 41 Panel QA cards at once): split them by area across 3–4 read-only
   sub-agents that fetch the cards, check the code and return draft comments; the parent posts,
   tags and moves. Tag ids: `claude` 17, `bug` 18, `needs answer` 16, `size: s|m|l` 20/19/21,
   `priority: low|medium|high` 32/33/34. Shay's QA codes carry a severity (EH/AH = high,
   EM/AM/NM = medium, EL/AL/NL = low; AN cards say it in the body): use it as the priority unless
   there's a reason, and say the reason.

## Feature workflow

1. Move card to *In Progress*. Comment: `🤖 Claude: Starting on branch <branch>.`
2. Branch from latest `main`: `claude/<card-id>-<slug>`.
3. Implement. Follow the project's own `CLAUDE.md` conventions. Add/adjust tests.
4. **Local verification (mandatory):** lint, unit tests, build. Then **end-to-end**: run the app and
   exercise the feature like a user —
   - Web: start the dev server (via `.claude/launch.json` + `preview_start`), drive it with the
     built-in browser, click through the feature, check the console for errors.
   - Desktop (Electron/Tauri): run the Playwright E2E suite (Electron supported), and launch the app
     to smoke-test. Where the desktop shell wraps a web UI, drive the UI in the browser too.
   - Record what was tested in the PR description ("E2E: ..." checklist).
5. Move to *Testing & CI*. Push, open a PR (`gh pr create`) with summary, card link, E2E notes.
6. Wait for checks (poll `gh pr checks --watch` with a sensible timeout). Fix failures.
7. Green → `gh pr merge --squash --delete-branch`. Move card to *Awaiting Release*, comment with PR link.
   If checks are still running when the run must end, leave the card in Testing & CI (step 3 next run).
   **Forge apps are the exception** (Panel, AniTrack, MDG, Obsidian Resource Pack Hosting): a merge
   to `main` *is* their release (Forge deploys it). Once the deploy is confirmed live, move the card
   straight to *Done* with `🤖 Claude: Released (live on <webUrl>) — <PR URL>.` They never wait in
   Awaiting Release, and the Monday train doesn't tag them (Shay: Panel Nov 2, all Forge apps
   Nov 10). Their registry entry has `hosting: "forge"`, so the downloads page shows "Live"
   instead of a stale tag. GroundStation (Easypanel) and Clerq (deploys on a tag) stay on the train. AniTrack's Chrome
   extension (`chrome-extension/`) isn't covered: a merge only refreshes the `extension-dev-latest`
   pre-release, and a stable build still needs an `extension-v*` tag.

## Release cadence

- **Weekly release train:** the first run on **Monday** releases every project that has cards in
  *Awaiting Release* (or other unreleased commits on `main`). Not the Forge apps (Panel,
  AniTrack, MDG, Obsidian): their merges are their releases (see Feature workflow step 7).
- **Hotfix:** cards tagged `hotfix` or `priority: critical`, or `bug`s that stop the app launching /
  lose data / are security issues (tag those `priority: critical`) → release immediately after merge.
- **First release:** a newly onboarded project gets a release as soon as its pipelines are green.
- **Versioning:** semver tags `vX.Y.Z`. Pre-1.0: features → minor, fixes → patch. Breaking changes
  need Shay's OK on a card. Version files (package.json, tauri.conf.json, etc.) bumped in the release
  commit.
- **Process:** bump version → commit `chore(release): vX.Y.Z` on main (via PR if branch protection
  requires) → tag → push tag → the project's release workflow builds and publishes the GitHub Release
  with assets → **verify every expected asset is attached** → rebuild the downloads page
  (`gh workflow run pages.yml -R PunterDigital/personal-apps`) and confirm the page shows the new
  version → move the released cards to *Done* with comment
  `🤖 Claude: Released in vX.Y.Z — <release URL>. Download: https://punterdigital.github.io/personal-apps/`.
- Release notes: generated from the merged PRs, grouped Features / Fixes, plain language.
- **Release PRs skip heavy CI** (Shay, Nov 14: a full Windows run per version bump is wasted
  usage). ProjectTrucks' `ci.yml` has a `Detect release bump` job (`scripts/is-version-bump.mjs`,
  merge-base diff): version lines + `CHANGELOG.md` only → the Windows job is skipped by `if:`,
  which still satisfies its required check; the tag's release workflow builds anyway. Keep the
  release commit to exactly those edits. Don't cancel a required job to save minutes: a cancelled
  job fails the check and blocks the merge.

## Onboarding a new project folder

1. **Inspect.** Stack, build system, how it runs, existing git remote, existing CI.
   - **Check the folder is its own repo:** `git -C <folder> rev-parse --show-toplevel` must print the
     folder itself. If it prints the control-repo root, the folder has no `.git` and every git command
     would hit the control repo — run `git init -b main` in the folder first.
   - Shay may name a project that has no folder yet: find it with `gh repo list PunterDigital`
     (and `ShayPunter`) and `git clone` it into a top-level folder of that name.
   - A project moved in from elsewhere on disk may be a subfolder of what Shay names (AniTrack's
     app was `E:\anime-list\backend`), checked out on an old feature branch: switch to `main` and
     pull before judging it. Its `.claude/worktrees/*` no longer point anywhere: `git worktree prune`.
     The registry `repo` can differ from the folder name (`PunterDigital/anime-list` → `anitrack`);
     don't rename a Forge-linked repo without asking.
     Check `git remote -v` matches the registry `repo`: a repo transferred from `ShayPunter` keeps
     the old URL, pushes still work through GitHub's redirect, but `gh pr create` fails ("Head
     sha can't be blank … No commits between"). `git remote set-url origin` to the new owner.
   - Check every workflow's `runs-on`: the org's self-hosted runner group accepts public repos
     (Clerq's CI ran on it), so a public repo can arrive using it. Move it to GitHub-hosted.
   - Copied-in `node_modules` are usually broken (pnpm symlinks don't survive copies): delete and
     reinstall from the lockfile before judging whether the project builds.
   - Run the project's own build/typecheck/lint/tests first and record what's broken — that's the
     baseline for the audit.
   - If the folder already has its own clean git history, push that as-is (no `Initial import`).
   - Commit the code exactly as received as `Initial import` on `main`, then do all onboarding fixes
     on a `claude/onboarding-ci` branch via PR, so the audit trail shows what changed.
2. **Repo.** If no remote → create `PunterDigital/<folder-name>` (`gh repo create --public --source`).
   If a remote exists in PunterDigital and is private → do the secret scan first, then make public
   (`gh repo edit --visibility public --accept-visibility-change-consequences`).
3. **Secret scan (blocking).** Scan working tree AND full history (`gitleaks`/`trufflehog` via npx or
   a regex sweep for keys, tokens, `.env`, private keys, connection strings). If anything real is found:
   do NOT publish — remove it, tell Shay (card + push notification) that the credential must be rotated,
   and if it is in history, ask before rewriting history.
4. **Hygiene.** `.gitignore`, `LICENSE` (MIT), `README.md` (what it is, install, dev, download link),
   project `CLAUDE.md` (stack, commands to install/run/test/build, E2E approach, quirks learned).
5. **CI** (`.github/workflows/ci.yml`): on PR + push to main — install, lint, typecheck, unit tests,
   build for each target platform (matrix: ubuntu for web, windows-latest, macos-latest).
6. **Release** (`.github/workflows/release.yml`): on `v*` tag — build Windows (`.exe`/`.msi`) and
   macOS (`.dmg`, universal or arm64+x64) artifacts, create the GitHub Release, attach assets.
   Web apps: deploy (GitHub Pages or wherever the app is hosted) and set `webUrl` in the registry.
7. **Repo settings.** Branch protection on `main` requiring CI; Dependabot (npm + github-actions, weekly);
   squash merge only; delete branch on merge.
8. **E2E.** If the project has no E2E tests, add a Playwright smoke test covering launch + core flow.
   Desktop apps must support an isolated profile for tests (env var → `app.setPath('userData', …)`)
   so tests never touch Shay's real data. Run the E2E against the packaged app too, not just dev.
9. **Registry.** Add the entry to `projects.json`; make sure the GroundStation tag exists.
10. **Audit report.** Create a card in Personal Apps titled `Audit: <name>` (tagged with the project
    tag + `claude`) summarising findings: code quality, security, dependencies, tests, pipelines.
    Each fix-worthy finding becomes its own card in Triage/Ready.
11. **First release** once CI is green, then the downloads page picks it up.

## Platform notes (learned the hard way)

**Electron + electron-builder**
- Don't let electron-builder rebuild native modules (`npmRebuild: false`): its bundled node-gyp can't
  find Visual Studio on `windows-latest` and needs Python `distutils` on macOS. Prefer N-API modules with
  prebuilt binaries; for the macOS x64 build, download the x64 prebuilt next to the arm64 one in CI.
- For SQLite, use Node's built-in `node:sqlite` (Node 24 / Electron 44) instead of better-sqlite3: no
  native module, no ABI rebuild, and a universal macOS build just works. A ~40-line wrapper keeps the
  better-sqlite3 `prepare`/`pragma`/`transaction` surface (Finance Dashboard `server/db.ts`).
- Unsigned macOS: electron-builder 25 can't ad-hoc sign (`identity: '-'` is treated as a keychain name
  and silently skipped), and it skips all signing on PR builds. Set `identity: null` and ad-hoc sign in
  an `afterPack` hook (`codesign --force --deep --sign -`). CI must run
  `codesign --verify --deep --strict` on every `.app`.
- Universal macOS (`arch: [universal]`): `afterPack` fires on the x64/arm64 `*-temp` builds and again on
  the merged app. Skip `appOutDir` ending in `-temp` in the signing hook, or the merge fails with
  "Expected all non-binary files to have identical SHAs ... CodeResources".
- Run the E2E suite against the packaged app in CI, not just the dev build.
- App icons: `win.signAndEditExecutable: false` also skips rcedit, so the `.exe` (and the taskbar) keeps
  Electron's icon even with `build/icon.ico` present. Set it to `true`: no certificate needed, nothing gets
  signed. Verify with `[System.Drawing.Icon]::ExtractAssociatedIcon` (Finance `scripts/check-win-icon.ps1`;
  run local `.ps1` files with `powershell -ExecutionPolicy Bypass -File`, the machine policy blocks scripts).
- `main` is branch-protected with required checks, so version bumps go through a PR too.
- Required checks match the job *name*. Renaming a job (e.g. "E2E (emulator, API 34)" → "API 36")
  leaves the old name required, and every PR is blocked. Keep versions out of required job names.
  If one has to change, updating the protection's `contexts` is a repo-settings change: say so in
  the run log (World Explorer #2428).
- Switching between branches with different Electron majors: `pnpm install` relinks, but Electron's own
  `install.js` (old `extract-zip`) can silently extract only one file under Node 24, leaving
  "Electron failed to install correctly". Fix: expand the cached zip from `%LOCALAPPDATA%\electron\Cache`
  into `node_modules/.pnpm/electron@<v>/node_modules/electron/dist` and write `path.txt` = `electron.exe`.
- Electron 44+ downloads its binary lazily on first `require('electron')`. With parallel Playwright
  workers on a fresh CI runner, two workers race on the download and one launches a half-extracted
  app (`dyld: ... load command content extends beyond end of file`). Resolve `electron` once in a
  Playwright `globalSetup` before workers start.
- Scheduled runs happen on an unattended machine: OS idle time is high and Playwright input doesn't
  reset it. Apps that auto-lock on system idle need an E2E env hook to turn that off.
- E2E clicks: click a specific spot, not the element centre, when the element contains nested
  buttons (e.g. breadcrumbs). CI runners have different home paths and window sizes.
- Layout E2E: test the minimum window with a real `BrowserWindow.setSize()` (the OS enforces
  `minWidth`), and large sizes (4K) with `page.setViewportSize()`, since a real window can't
  outgrow a CI runner's screen. Viewport emulation can't be switched off again, so do it last in a
  test or after a relaunch. `main.scrollWidth` misses controls clipped by a nested
  `overflow-hidden` box: also compare each control's rect with the container's (Nexus `app-shell.spec.ts`).
- Parallel Playwright workers share the OS clipboard. A spec that asserts the clipboard gets cleared
  (Nexus `security-settings.spec.ts`) fails when another spec copies at the same time. Specs that
  only check *what* a button copies should record `navigator.clipboard.writeText` in the page
  instead (Nexus `keychain.spec.ts`).
- Chromium switches passed to `electron.launch` args (`--disable-webgl`, `--disable-3d-apis`) don't
  reach the renderer. To read xterm.js output in E2E, hide WebGL2 with
  `app.context().addInitScript` (patch `getContext('webgl2')` → null) and `page.reload()`, so xterm
  falls back to its DOM renderer and `.xterm-rows` holds the text (Nexus `ssh-session.spec.ts`).
- esbuild-bundled main process: load an *external* CJS package lazily with `require()`, not
  `await import()`. esbuild's ESM interop wrapper lost electron-updater's `autoUpdater` getter
  (undefined only in the packaged app). Test such paths on a packaged build (Nexus `src/main/updater`).
- Auto-update can be tested for real without touching Shay's install: package with
  `-c.extraMetadata.version=<older>` and run it with a test profile plus the app's opt-in env
  (Nexus: `NEXUS_UPDATE_IN_TEST_PROFILE=1`). It downloads the current release. Never click
  "Restart to update". Shay's real install can have its own download waiting in
  `%LOCALAPPDATA%/<app>-updater/pending` (Nexus had 0.3.1 there on Nov 9), so don't share that
  folder: set `updaterCacheDirName: <app>-updater-test<card>` in the test build's
  `win-unpacked/resources/app-update.yml` and delete that folder afterwards (Nexus #4351). The real
  folder also holds `installer.exe` from his install (NSIS keeps it, even for `publish: null` apps).
  Build the NSIS target, not `--dir` (no `resources/app-update.yml`). For a local feed, edit
  `win-unpacked/resources/app-update.yml` by hand (`provider: generic`, `url:`); a
  `-c.publish.provider=generic` override fails the schema when the yml sets owner/repo (Finance #3353).
- An uncaught exception in the main process pops a native "A JavaScript error occurred" dialog on
  Shay's screen, even during E2E. Express's `res.download` callback runs while Windows still has the
  file open, so deleting it there throws (ENOTEMPTY). Send a Buffer, or clean up later (Finance #2719).
- Playwright doesn't fire `download` events for Electron: set the save path in a `will-download`
  handler via `app.evaluate` (Finance `settings.spec.ts`).
- Keep native-module loaders (e.g. a SQLCipher DB layer) out of the static import graph of modules
  that unit tests import: the ubuntu CI job may not be able to load the binary (SQLCipher's
  prebuilt needs libcrypto 1.1). Use a lazy `await import()` at the call site.

**Tauri 2 (Rust + system webview)**
- E2E: Playwright can't launch Tauri, but WebView2 speaks CDP. Mark the window `create: false` and build
  it in `setup` with `WebviewWindowBuilder::from_config`; when a test env var is set, add
  `additional_browser_args("<wry defaults> --remote-debugging-port=<n>")` and a temp `data_directory`.
  Then `chromium.connectOverCDP` (no Playwright browser download needed). Don't rely on the
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` / `WEBVIEW2_USER_DATA_FOLDER` env vars: they work locally but
  GitHub's Windows runners ignore them. Windows only. macOS (WKWebView) CI gets a universal build,
  `codesign --verify`, and a launch smoke test. Isolate app data with an env var the Rust side reads in
  place of `app_data_dir()`.
- Unsigned macOS: `bundle.macOS.signingIdentity: "-"` ad-hoc signs. Build
  `--target universal-apple-darwin` with both Rust targets installed.
- Tauri's build script requires `frontendDist` (`dist/`) to exist, even for `cargo clippy`/`test`:
  build the frontend first.
- A copied-in `src-tauri/target` from another path fails with "failed to read plugin permissions …
  app_hide.toml": delete it, the same as copied `node_modules`.
- `app.security.csp` only applies to bundled assets: `tauri dev` (and a debug binary on the Vite
  devUrl) runs with no CSP at all. Check CSP changes on a release binary, with an E2E fixture that
  fails on console errors after a reload (ProjectTrucks `e2e/fixtures.ts`).
- Release: create the GitHub Release (`gh release create --generate-notes`) in a first job, then
  `tauri-action` with the same `tagName` uploads to it from each OS. Finish with an asset-check job.
  tauri-action v1 updates the name and body of an existing release from its inputs (empty body =
  notes wiped): export the generated notes as a job output and pass them as `releaseBody`
  (ProjectTrucks `release.yml`). For hand-written notes, run
  `gh release create vX --target <merge sha> --notes-file …` instead of pushing the tag. It
  creates the tag, the workflow sees that the release exists and passes its body on (v0.6.1).
- Self-update without Tauri's updater plugin (no signing key): download the `_x64-setup.exe`,
  check GitHub's asset `digest` (`sha256:…`, on every release asset), run it with `/P /R /UPDATE`
  (passive, relaunch, keep removed shortcuts removed) and exit. To test: build an older version
  with `pnpm tauri build --no-bundle --config '{"version":"0.4.0"}'` and serve a stub
  `*setup.exe` from a local feed. The stub needs an `asInvoker` manifest, or Windows' installer
  detection asks for elevation from the name alone (`rustc stub.rs -C link-arg=/MANIFEST:EMBED
  "-Clink-arg=/MANIFESTUAC:level='asInvoker' uiAccess='false'"`). Never run a real installer:
  it replaces Shay's install (ProjectTrucks #3354).

**Forks of upstream projects (Arkeep)**
- Shay may name a GitHub fork of someone else's project (`gh api repos/<repo> --jq .fork,.parent.full_name`).
  Ask what it's for before onboarding: for Arkeep (Nov 13) it's "our own patched builds + contribute
  occasionally". The registry gets `upstream: "<owner>/<repo>"`.
- Don't run the usual onboarding rewrite: keep the upstream licence (Apache-2.0 there, never swap
  to MIT), no `Initial import`, and leave upstream's files alone. Our CI/release go in **new** files
  (`pd-ci.yml`, `release-pd.yml`, `.goreleaser.pd.yml`), and our app changes are listed in the
  project's `PATCHES.md`. Every edit to an upstream file is a conflict on the next sync.
- Upstream workflows that publish to upstream's registries or open PRs (`release.yml`,
  `registry-metadata.yml`, `sponsors.yml`, `deps-pins.yml`) get `gh workflow disable`d: a repo
  setting, no file change. They only register after a push to the fork's `main`, so disable them
  after the first merge and **before** pushing any tag. Dependabot version updates stay off
  (bumps arrive with upstream syncs).
- A new fork runs `pull_request` CI straight away (Actions were enabled on PunterDigital's fork).
  Arkeep's `main` requires upstream's 14 PR job names plus our two: when a sync renames or
  drops an upstream job, update the protection's checks in the sync PR (repo setting, say so in the run log).
- Pushing more than 3 tags at once fires no workflows, so the upstream tags went up in one push.
  The first `-pd` tag still fired upstream's `release.yml` (its tag check refuses `-pd` before
  any secret is used; it also auto-created an empty `release` environment); it's disabled since.
- Upstream's `.gitignore` may list `CLAUDE.md`: `git add -f` it rather than editing their ignore file.
- Versions: `vX.Y.Z-pd.N` on top of upstream `vX.Y.Z`; push the upstream base tag to the fork
  too. Upstream syncs merge the upstream **release tag** with a merge commit (never squash), then
  release `-pd.1`. Weekly maintenance checks `gh release list -R <upstream>` for each registry entry
  with `upstream` (recipe in Arkeep's `CLAUDE.md`).
- Public fork = GitHub-hosted runners only, even if Shay asks for the self-hosted one (he agreed
  once the fork-PR risk was explained, Nov 13). A fork of a public repo can't be made private.
- **The `upstream` tag decides where a change goes** (Shay, Nov 13). A card tagged `upstream`
  is built for upstream: a branch from the upstream branch they take PRs on (Arkeep: `develop`),
  following their CONTRIBUTING.md, opened as a PR against the upstream repo. **Code only**
  (Shay): the change and its tests, never CLAUDE.md, PATCHES.md or our CI/E2E files; check
  `git diff --name-only upstream/develop...HEAD` before pushing. **No Claude attribution**
  upstream either: no `Co-Authored-By: Claude` trailer, no "Generated with Claude Code" in the
  PR body (overrides the session default; `git log upstream/develop..HEAD --format=%B | grep -i
  claude` prints nothing). Our own PRs on the fork keep it. The tag is Shay's
  OK to open that public PR under his name. We also carry it in our build (cherry-pick onto our
  `main` via our own PR, a `PATCHES.md` row with the upstream PR link) until an upstream release
  includes it; the sync that brings it in drops the row. A card **without** the tag is a
  fork-only patch: never offer it upstream unasked. Claude may suggest the tag in a triage
  comment but doesn't add it; only Shay does. If the comments show Claude put the tag on
  (#4560: "Tagged `upstream` under Shay's new rule", onboarding session), it isn't his OK:
  build it, push the upstream branch to our fork, and ask on the card before opening the PR.
  The same goes for cards that arrive with the tag already on and look machine-made: #4567–#4569
  came through the connector, three in 5 seconds at 23:23 UTC with long specs, so an assistant
  session (not Shay by hand) may have tagged them. Ask once, on one card, for all of them.
  Upstream wants an **issue first** for non-trivial changes (their CONTRIBUTING): the issue
  counts as part of the same OK. Drafts wait in `ops/upstream-drafts/` (gitignored, local
  only) until then. An `upstream` card isn't Done until our build ships
  it; the upstream PR's fate goes in a comment (merged, changes asked, closed).

**Private repos (free plan)**
- No branch protection or rulesets (needs GitHub Pro): there are no required checks, so confirm CI
  is green yourself before merging.
- Actions minutes are capped (2,000/month), so a self-hosted runner is fine and preferred, but only
  while the repo is private. Move CI to GitHub-hosted runners *before* any visibility change.
- The downloads page can't read a private repo's releases (the Pages token only sees public repos)
  and its source link would 404, so `private: true` makes `build-site.mjs` skip both and show
  just the web link. Releases are still tagged and published in the repo.
- `gh api .../actions/runners` needs `admin:org`, which the gh token lacks: the runner's health
  is only visible through whether jobs get picked up.
- A hung job blocks every private repo's CI. Panel's E2E step once sat 66 minutes with no output
  and no job `timeout-minutes` (the default is 6 h); cancel and rerun (it passed in 8 min), and keep
  an eye on runs over 20 minutes (Oct 26).
- The self-hosted runner runs one job at a time. Turning on Dependabot opens a burst of PRs whose
  CI fills the queue, so a release tag pushed right after onboarding can wait 10+ minutes. Push
  the tag before enabling Dependabot, or expect the wait.
- **GroundStation** (`groundstation/`) is the app this board and the GroundStation MCP connector
  run on. A merge to its `main` redeploys the pipeline's own board, so after every merge check
  the live site *and* that an MCP call still answers before carrying on with the run.
  Check the deploy with `curl https://app.groundstationhq.com/version`: its `commit` is the
  Publish run's `github.sha` (a build arg, #4454), so it moves on every merge, workflow-only
  ones included (`app.js`'s `Last-Modified` doesn't, #3838). Plus a working MCP call.
  If the site answers Easypanel's 502 page (hexagon logo) with no recent deploy while Clerq on the
  same host is up, the service container is down: `gh run rerun` the last Publish run on `main`
  redeploys the same commit (back in ~2 min, Nov 8). The MCP connector still failed for the
  rest of that run afterwards (connector status "connected"), so expect a run with no board.
  Nov 12 (down between the 19:03 and 21:03 runs) the same rerun brought it back in ~3 min and
  the connector answered straight away, so retry the board once after `/version` returns 200.
  When GroundStation **and** Clerq both time out (curl `000`, or a 504) while other sites answer,
  the Easypanel host itself is down: a Publish rerun can't help. Nov 9 18:30 UTC it came back by
  itself after ~15 minutes and the MCP connector worked again at once. Wait, don't redeploy.

**Docker-image web apps (Clerq)**
- Release on a `v*` tag: build + push the GHCR image, POST the repo's `DEPLOY_WEBHOOK_URL`
  secret (Easypanel deploy webhook; the service tracks the `latest` tag) to redeploy production, then `gh release create --generate-notes`. No release assets.
- Verify a deploy with `curl https://app.useclerq.net/version` (`{"version":"x.y.z"}`); the
  release's deploy job waits up to 15 min for it to match the tag. Don't trust the webhook's 2xx
  or the HTML: a no-code-change release rebuilds byte-identical Next.js chunks. If it never
  rolls over, check Easypanel isn't pinned to a fixed image tag (it was until v1.4.0).
- Postgres-backed E2E on this machine: published ports don't reach the host, so run migrate,
  seed, build and Playwright inside `mcr.microsoft.com/playwright:v<version>-noble` on a Docker
  network with the DB (recipe in Clerq's local `CLAUDE.md`).
- Clerq gitignores `CLAUDE.md`/`.claude/` on purpose: its project notes stay local, uncommitted.
- Clerq's only API is MCP JSON-RPC (`POST /api/mcp`, `tools/call`; the `Accept` header must list
  `application/json, text/event-stream` or it answers 406). Its bearer tokens are better-auth `mcp()`
  OAuth tokens that expire after 1 hour, so another app can't use a static token (#3330).
  `update_client` overwrites every field: `get_client` first and send the rest back (Panel #3200).

**Laravel web apps (Forge-hosted)**
- No desktop builds: CI is one ubuntu job (Pint, `npm run build`, Pest, Playwright E2E). Forge
  auto-deploys `main` on push, so every merge is a production deploy; check the live site after.
  That covers Panel, MDG, Obsidian and AniTrack, just like GroundStation's own deploy (Shay, Oct 28).
  A dependency bump on such an app is a production change too: AniTrack's Vue 3.5.44 advisory
  bump shipped broken SSR ("[object Promise]" in every page) until #3408. Its E2E now covers SSR.
  A release is a tag + GitHub Release with notes; registry entry is `platforms: ["web"]` + `webUrl`.
- `phpunit.xml` must force in-memory SQLite: Breeze's Pest suite uses `RefreshDatabase` and would
  otherwise wipe the `.env` database.
- Feature tests render Blade and need the Vite manifest: build assets before `php artisan test`.
- E2E: Playwright `webServer` runs `php artisan serve` with env-var overrides (env beats `.env` in
  Laravel) pointing at a throwaway SQLite file. Reset that file inside the webServer command, not at
  the top of `playwright.config.js` — workers re-load the config after the server has migrated.
  A stale `public/hot` makes pages load from a dead Vite dev server (blank page): delete it.
- `pint` isn't always idempotent; run `pint --test` after `pint`.
- `laravel/pao` (Panel) sees Claude's env (`AI_AGENT`) and turns PHPUnit/PHPStan output into a
  one-line JSON summary that leaves out deprecations and warnings. To read the full report (e.g.
  after a PHPUnit major), run with `PAO_DISABLE=1` (Panel #3796).
- Laravel major upgrades (Obsidian #2533, 12 -> 13 with Inertia 3 and Pest 5): `composer update -W`
  resolves it in one go, but `boost:update` (post-update-cmd) does not refresh the version labels in
  the CLAUDE.md `<laravel-boost-guidelines>` block: edit them by hand. Inertia 3 needs the config
  republished (`vendor:publish --provider="Inertia\ServiceProvider" --force`) and `<title inertia>`
  -> `<title data-inertia>`. Pest 5 keeps collision on 8.x. Pest 5 brings PHPUnit 13, which warns
  when a `#[DataProvider]` row has more values than the test takes: add the parameter (AniTrack
  #4441). An app config file without `serializable_classes` keeps cached objects working (the
  framework's base `cache.php` has no such key, so it stays `null`), and a config that already
  uses the hyphen prefixes (`-session`, `-cache-`) keeps its cookie name: check both before
  merging, or everyone gets signed out.
  The republished v3 config defaults SSR **on**, comments out `bundle` and lowercases the pages
  path (`js/pages`): re-apply the app's values. With SSR, the props move to a
  `<script data-page="app" type="application/json">` and the root is
  `<div data-server-rendered="true" id="app">`, so SSR specs that match `data-page="…"` on the div
  need updating. A fallback `<title>` next to `@inertiaHead` gives SSR pages two titles (the
  fallback first): wrap it in `<x-inertia::head>`, which prints its slot only without SSR. An
  Inertia 2 SSR workaround (AniTrack's "[object Promise]") can go: v3 awaits the render (AniTrack #107/#109). Dependabot does not close PRs that a
  hand-rolled bump superseded: `gh pr close --delete-branch --comment` them after the merge.
- A `composer update` can bump Pint (its constraint is loose) and bring new rules. `pint` then
  turns fully-qualified names into imports, and in `tests/Pest.php` it puts the `use` lines below
  the `pest()->extend(TestCase::class)` calls that need them ("The class `TestCase` was not
  found"). Move the imports to the top of the file and rerun Pest.
- Playwright E2E via `php artisan serve` with `CACHE_STORE=array` can't exercise rate limits: every
  request is a fresh PHP process, so the cache is always empty. Cover throttles in Pest.
  The same empty cache hides every Filament 5 toast (they wait in the cache for the page's next
  request): Filament E2E needs `CACHE_STORE=database` on the throwaway SQLite (Panel #2914).
- Filament ignores a call to a mounted action that has become `disabled()` since its modal
  opened: the modal stays open and nothing is said. Keep `disabled()` to the button and let the
  action class refuse (Panel `RoleResource::isOpen()`). The same goes for `visible()`: a button
  that depends on the record's status should follow the status the page loaded with (a public
  Livewire property), not the re-fetched record (Panel `ViewApplication::$shownStatus`).
- Filament in Playwright: list-page tabs are `button`s, not `tab`s, and relation managers load
  lazily ("Loading...") until scrolled into view (`scrollIntoViewIfNeeded()`).
  A Filament `FileUpload` never worked in E2E: with `APP_ENV=testing` Livewire stores temporary
  uploads on a `tmp-for-tests` disk and, when it isn't configured, calls `Storage::fake()` on every
  request (a new process each under `artisan serve`), wiping the upload before Save (FilePond
  "processing-error"). Define the disk in `config/filesystems.php` (Panel #3598). A table action
  named `edit` makes the whole row a button whose name holds the row text, which breaks older
  `getByRole('button', { name })` lookups: `->recordAction(null)` keeps rows plain.
- A Filament `Select::options(SomeEnum::class)` gives the action the enum instance, not its
  value: `SomeEnum::from($data['x'])` is a TypeError (500) only in the browser, since tests that
  pass plain strings skip the cast. Accept both in the action, and test the form through
  `callAction` with the real field (Panel #2796).
- Composer 2.9 refuses to resolve any package version with a known advisory (`block-insecure`).
  Every Laravel 11.x is affected (fixes only in 12+), so `composer update` fails outright. Use
  `COMPOSER_NO_SECURITY_BLOCKING=1` for an in-range update and card the major upgrade.
- Breeze shares `auth.user` (the full model) with every Inertia page. Leak checks on public pages
  must run as a guest (fresh Playwright context), or they flag the viewer's own email.
  The model goes out **with any relation a controller loaded on it** (`$request->user()->application`
  sent the whole row, staff-only columns included). Share `$request->user()?->withoutRelations()`
  and test that `auth.user.<relation>` is missing (Panel #2792).
- Forge deploys can be confirmed by watching the `build/assets/app-*.js` hash on the live homepage
  change (the hash differs from a local build). A server-only change, or a deploy that finished
  before you started watching, won't move the hash: check the changed behaviour on the live site
  with `curl` instead.
- New Laravel apps: `composer create-project laravel/vue-starter-kit <dir> --stability=dev` (Laravel 13,
  Inertia 3, Fortify, Vite+). Its feature installer (`laravel/chisel`) fails at the final
  `vp check --fix` ("All matched files may have been excluded by ignore rules") because Vite+
  applies this control repo's `.gitignore` until the folder is its own repo: `git init -b main`
  first, or rerun `npm run check:fix` after it, then delete `chisel*.php` and
  `InstallFeaturesCommand.php` and `composer remove laravel/chisel`. Its `.gitignore` ignores
  `CLAUDE.md`: remove that line so the project notes are committed.
- SQLite (PHPUnit, E2E) accepts index names of any length; MySQL refuses over 64 characters
  (Postgres cuts at 63). A generated `<table>_<cols>_index` over the limit passes CI and stops
  the production migration half way: tables left, migration unrecorded, every later deploy
  fails "already exists", and the new routes stay 404. Name long indexes explicitly; Panel's
  `tests/Feature/Database/IdentifierLengthTest.php` checks every name (Panel #2793).
- Vue + Inertia `<Form>` with a native `<select :value="…">`: Vue sets the value before the
  `<option>`s exist, so the first option shows and is what gets submitted next time. Put
  `:selected` on the options instead, and have E2E check the saved value after the reload (Panel #2797).
- Filament Livewire tests: an action that calls `$action->halt()` stays mounted, so a second
  `callAction` on the same test instance fails with "Action [x] was not found". Use
  `assertActionMounted()` and a fresh `Livewire::test()` for the next call (Panel #2798).
- Don't run other heavy commands (migrations, artisan, builds) while the full local Playwright
  suite runs: unrelated specs time out (Panel #2798, two specs failed, then 42/42 on a quiet rerun).
- PDFs on Forge: spatie/laravel-pdf v2 with its DOMPDF driver needs no Chrome on the server
  (Panel `config/laravel-pdf.php`). DOMPDF has no total-pages CSS counter.
- Laravel 13's CSRF middleware is `PreventRequestForgery`, not `ValidateCsrfToken`:
  `->withoutMiddleware(ValidateCsrfToken::class)` on a webhook route does nothing (419). Exclude
  the path with `$middleware->preventRequestForgery(except: [...])` in `bootstrap/app.php`. PHPUnit
  skips CSRF, so only E2E (or a real caller) catches it (Panel #2799). A browser-driven E2E
  can miss it too: Chrome's form POST sends `Sec-Fetch-Site: same-origin`, which
  `PreventRequestForgery` accepts without a token. Test with Playwright's `request` fixture
  (no such header, like curl or a bot) (AniTrack #4488).
- Documenso (self-hosted e-signature, Panel `App\Signing`): complete a contract only on
  `DOCUMENT_COMPLETED`. The last signer's `DOCUMENT_SIGNED` already shows everyone signed, but the
  PDF is sealed after it, and `download?version=signed` returns the original until then. It
  refuses webhooks to private addresses unless `NEXT_PRIVATE_WEBHOOK_SSRF_BYPASS_HOSTS` lists the
  host. A real local check works without published ports: Postgres + Mailpit + Documenso on a
  Docker network, the cert `.p12` copied in with `docker cp`, the UI driven by a throwaway
  Playwright script in `mcr.microsoft.com/playwright`, and the app in `php:8.4-cli` (recipe in
  Panel's `CLAUDE.md`, Panel #2799).
- `env('X', fallback)` returns `''` for an empty `X=` line, so the fallback never applies. Any
  variable listed empty in `.env.example` (CI copies it to `.env`) needs `env('X') ?: fallback`.
  Local runs passed and CI failed (Panel #2811).
- S3-compatible checks: MinIO's Docker Hub images (`minio/minio`, `minio/mc`) are gone. Use
  `adobe/s3mock` (`COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=<bucket>`, http :9090, path
  style) on a private Docker network, with the app in `php:8.4-cli` on the same network (Panel #2811).
- Tailwind 3 → 4 (`npx @tailwindcss/upgrade`, then `@tailwindcss/vite`): the tool leaves the
  removed `bg-opacity-*` / `ring-opacity-*` utilities in place (grep for `-opacity-[0-9]`), and
  Breeze's `Modal.vue` panel needs `relative` or the backdrop swallows every click once the open
  transition ends. E2E that clicks mid-transition passes anyway: wait for the panel to be fully
  opaque first (MDG `smoke.spec.js` `settle()`). Diff before/after screenshots of every page
  from a scratch worktree of `main` (MDG #2881).
- A frontend toolchain major can stop Forge deploys while the site stays up: the push webhook
  answers 200, the server's asset build fails (Vite 8 needs Node 20.19+), and the old
  `public/build` keeps serving. Always confirm the asset hash changed, but give a toolchain
  major time: MDG's first Vite 8 / Tailwind 4 deploy took 14 minutes to appear (the run
  flagged it as failed at 12). Check again next run (or `curl` the CSS for `tailwindcss v4`)
  before flagging it to Shay (no Forge log access from here) (MDG #2881).
  Dependabot's lone Vite 8 PR fails `npm ci` (ERESOLVE) while an old `@tailwindcss/vite`
  (4.1.11's peer range stops at Vite 7) or laravel-vite-plugin 2 is in the lockfile: bump vite,
  laravel-vite-plugin 3, @tailwindcss/vite
  and @vitejs/plugin-vue in one PR. Vite 8 builds with rolldown, so an old
  `@rollup/rollup-linux-x64-gnu` optional pin can go (Obsidian #3838; deployed in under a minute).
- A Forge deploy that never goes live (webhook delivery 200 in `gh api repos/<repo>/hooks`, but the new
  route still 404 an hour later and the asset hash unchanged) needs Shay: there is no Forge log access
  from here. Flag it on the merged card and push-notify, and hold further merges to that app (open the
  PR, get CI green, leave it in Testing & CI with a "merge on hold" comment) so changes don't pile onto
  a broken deploy (Panel #3197, Oct 25).
  Forge doesn't retry a failed deploy: production stays on the old release until the next push to
  `main`. Panel's cause was the build, not the code: laravel-vite-plugin's `bunny()` font provider
  downloads fonts during `vp build`, and one ETIMEDOUT on the server failed it. Builds that run on
  Forge must not need the network beyond the package registries: commit the font files and use
  `local()` (Panel `vite.config.ts`). MDG and Obsidian load Bunny with a `<link>` in the browser,
  which can't fail a deploy (#3197, Oct 26).
- Forge's default `.env` has `APP_URL=http://<domain>` and adding the certificate doesn't change it.
  Anything that compares APP_URL with the browser's origin breaks on the https site: passkeys
  failed with "Invalid origin. Not in the list of allowed origins." Panel now allows the https
  origin of APP_URL's host (`App\Auth\PasskeyOrigins`). WebAuthn refuses an IP as RP ID, so check
  passkeys on `php artisan serve --host=localhost` with a CDP virtual authenticator, not on the
  E2E server's `127.0.0.1` (Panel #3531).
- PHPUnit on MySQL in a Laravel app's CI (Panel #3674, Shay's request after the #3671 deadlock
  that SQLite CI couldn't see): the self-hosted runner can't reach a service's published port
  (Connection refused, as in GroundStation), so pipe the tree, `vendor/`, `.env` and the build
  into `php:8.4-cli` on `${{ job.services.mysql.network }}` (host = the service name). The image
  lacks intl, zip, pdo_mysql and gd, and caps memory at 128M (`memory_limit=-1` in a conf.d
  file). `phpunit.xml`'s unforced `DB_*` let `-e DB_CONNECTION=mysql …` win. The job context
  (`job.services`) isn't available in job-level `env`: a workflow using it fails to start
  ("workflow file issue", no checks on the PR). MySQL JSON columns reorder object keys, so
  `assertSame` on a decoded JSON array fails on order alone: use `assertEquals`. E2E stays on
  SQLite (the browser and server run on the runner). A PR that is CONFLICTING gets no
  `pull_request` CI at all: resolve with the `commit-tree` merge below.
- MySQL row-lock bugs (deadlocks between a request and an immediate webhook, Panel #3671):
  a `FOR UPDATE` on a unique column that matches nothing gap-locks the index. Find the id with
  a plain read and lock by primary key. A MySQL-only test can hold the row on the test's
  connection and run the other side on a cloned connection with
  `innodb_lock_wait_timeout = 1` (Panel `ContractSigningTest`).
- Playwright's `fill()` on a Filament search box right after a modal closes can lose the
  text: Filament gives focus back to the opening button on a timer, and on a busy runner it
  lands inside `fill()` (focus + select, then a separate Delete/insertText), so the keys go
  to the button. `fill()` never checks the result. Retry `fill` + `toHaveValue` in
  `expect(...).toPass()` (Panel `trials.spec.ts` `searchTable()`, #3832). Also,
  `waitForLoadState('networkidle')` returns at once once the page has been idle a single
  time, so it never waits for a Livewire request: wait on what the page shows.
- Filament form fields (Textarea and others) start their Alpine component lazily (`x-load`) and
  only then `$entangle` `mountedActions.0.data.<field>`. A spec that submits a dialog before that
  logs "Livewire Entangle Error … cannot be found" once the action is unmounted (console only,
  the action works). Panel's `waitForLazyComponents(dialog)` in `fixtures.ts` waits for every
  `[x-load]` element to have Alpine data (#4051).
- This PC runs Panel E2E ~4x slower than CI (each `artisan serve` request is a new PHP process):
  a spec that takes 14 s in CI took 60 s here. A local-only timeout on whatever step came last
  is the spec's `timeout` budget, not that step: compare the trace's test start with the
  failure time before debugging the step (#4092).
- A Filament page left in a background tab (a spec opened a second `browser.newPage()` for the
  client) never pulls its toast: `bringToFront()` before the next action whose toast you assert
  (Panel `organisation-approval.spec.ts`, #3536).
- Filament's confirmation modal is an `alertdialog` whose own box has no size: `toBeVisible()` on
  it fails ("hidden") even while it's open. Assert its heading. A click on a section action before
  Livewire has loaded opens nothing: wait for the page to settle, or retry the click until the
  heading shows (Panel `rate-four-eyes.spec.ts`, #3650).
- Passkeys: AniTrack moved from laragear/webauthn (abandoned) to laravel/passkeys (#4237).
  Pest needs no fakes: AniTrack's `tests/Support/SoftwareAuthenticator.php` signs real ES256/RS256
  assertions (Windows PHP's `openssl_pkey_new` needs `config` => `<php>/extras/ssl/openssl.cnf`;
  no ext-sodium here, so Ed25519 code only ever runs in CI). laravel/passkeys 0.3 verifies
  ES256/RS256 only: an EdDSA key gives a 500 ("Unsupported algorithm"). Its `user` relation
  hides soft-deleted users and its `PasskeyVerified` event then gets null (500): use a
  `withTrashed()` model. Browser E2E: CDP virtual authenticator on `http://localhost` (WebAuthn
  refuses an IP as RP ID); `WebAuthn.addCredential` with a known PKCS#8 key tests a seeded or
  migrated credential. To prove a credential migration, register on `main` with a virtual
  authenticator, save `WebAuthn.getCredentials` and the DB, migrate on the branch, and sign in
  with the saved credential. A rate limiter `->by($request->input('email'))` puts every
  email-less request (passkeys) in one site-wide bucket. Playwright's `page.url()` right after
  clicking an Inertia link can still be the old URL: wait for something on the new page first.
- Add new E2E seed data at the **end** of an `E2ESeeder`: a new organisation seeded mid-file shifts the
  ids of every later record, and an older spec that depends on them broke (Panel `organisation-approval`
  failed with a Livewire entangle error until the seed moved, #3605).
- After rebasing a branch, run `npm run build` again before E2E: a stale `public/build` from before
  the rebase makes Playwright fail on UI that is already in the code. But don't run the build while
  PHPUnit runs in the same checkout: it replaces `public/build/manifest.json`, and a feature test that
  renders a page at that moment fails (Panel #3981, a 9 s HireRequestContractorTest failure, 14/14 alone).
- Error pages rendered from `withExceptions()->respond()`: an unmatched URL never runs the web
  middleware (no session, so a signed-in user looks like a guest), and a route-binding or CSRF
  error comes before `HandleInertiaRequests` (no shared props: the layout's `route()` and auth
  break). A `Route::fallback` fixes the session, but it is GET-only, so a POST to an unknown URL
  turns into 405: use `Route::any('{fallbackPlaceholder}', ...)->where(..., '.*')->fallback()
  ->withoutMiddleware(<CSRF class>)`, and share the layout props in the handler when
  `Inertia::getShared('auth')` is null (AniTrack `App\Support\ErrorPageProps`, #3916).
- A product name in browser tabs: Inertia 3's `createInertiaApp({ title: (title, page) => … })`
  gets the page, so read a shared `name` prop. `VITE_APP_NAME` bakes the server's `.env` value
  into the Forge build. Don't rename via `APP_NAME` on a live app: it also names the session
  cookie and cache prefix, so everyone gets signed out (Panel #3602).
- Vite+ (`vite-plus`, the starter kits' toolchain) ≥ 0.3.3 needs `vite` aliased to
  `npm:@voidzero-dev/vite-plus-core@<same version>` (plus an `overrides.vite` for the plugins'
  peers). Upgrading it with npm: the old lock keeps `vite@8` on top and npm fails with a
  misleading `@vue/language-core` peer conflict; delete the toolchain entries from
  `package-lock.json` and reinstall. `vp migrate` switches the project to pnpm (reverted). Vite+
  1.x also needs vue-tsc 3.2/3.3: 3.3.12–3.3.14 break `types:check` on any `https://` in a
  template attribute (vuejs/language-tools#6240), so Panel and AniTrack pin 3.3.11 (Panel #2801,
  AniTrack #88). A Dependabot group that pulls a newer vue-tsc in needs the pin back.
  Larastan 3.13.2+ reads the `#[Signature]` attribute, so an `is_string()` check on a required
  command argument is "always true" and fails PHPStan (Panel #116).
- A `date:Y-m-d` cast only formats on read: Eloquent still writes `Y-m-d H:i:s`, so on SQLite
  a string `BETWEEN` / `>=` on that column misses the boundary day. Query dates with
  `whereDate()` (Panel #3081).
- Panel's `IdentifierLengthTest` rebuilds Laravel's default foreign-key name from the schema
  (SQLite exposes no FK names), so `constrained(indexName:)` can't rescue a long pivot: pick a
  shorter table name (`organisation_required_checks`, not
  `organisation_compliance_check_type`) (Panel #3081).
- Filament form-level rules (`maxDate`, `after`) refuse before the action class runs: a Livewire
  test that expects the action's toast for such input must `assertHasActionErrors` instead, or
  the rule belongs in the action only (Panel #3081).
- E2E that build "today" with JS local getters (`getDate()`) disagree with a UTC server
  between 00:00 and 01:00 BST (the local date is a day ahead): use the UTC getters, or
  read the date the page shows (Panel `self-service.spec.ts`, #2882).
- Inertia E2E races: a login helper that returns right after the submit click can lose to the
  next `page.goto` (the goto wins and the test lands on /login). `await expect(page).toHaveURL(...)`
  first. `getByRole('checkbox', { name })` matches the whole `<label>` text, so a label with a
  description span needs an `aria-label` on the input. A `page.goto` to a 403/404 logs a Chrome
  console error: assert `collectErrors()` before such visits (Panel #3080).
- Panel has no ParaTest, so `php artisan test --parallel` fails at once (Collision "requires
  ParaTest"): run the suite serially in a `run_in_background` Bash call (~5 min, 990 tests).
  A second card can be tested in a scratchpad worktree at the same time (own `composer install`,
  `npm ci`, copied `.env`, `npm run build`) while the first PR's CI runs (#3962/#4010, Nov 2).
  Both checkouts' Playwright servers default to port 8124: give each its own `E2E_PORT`
  (`tests/e2e/env.ts`), e.g. 8134 and 8144, and run only the related specs, one worker,
  while the other side is installing or testing (#3966/#3967, Nov 3).
  AniTrack's E2E has `E2E_PORT` / `E2E_DB` too, but its gtag and SSR servers keep their SQLite
  files in `os.tmpdir()/anitrack-e2e/` whatever `E2E_DB` says: a second checkout's run sets
  `TEMP`/`TMP` to its own scratch folder, or the two reset each other's databases (#4488).
- Panel uses `data-test` attributes, not `data-testid`: Playwright `getByTestId` finds nothing, use `locator('[data-test="x"]')`. A new Bash call falls back to PHP 8.3 unless the 8.4 `PATH` export is repeated (Panel #3082).
- A new Filament navigation badge changes the sidebar link's accessible name ("Organisations" becomes
  "Organisations 3"), so every older spec with `getByRole('link', { name: 'Organisations', exact: true })`
  stops finding it: use a prefix regex (`/^Organisations/`). A taller view page also pushes the lazy
  relation managers off screen: `scrollIntoViewIfNeeded()` the tabpanel before asserting (Panel #3193).
- Filament 5.11+ draws a required single-choice `ToggleButtons` as hidden radios with styled
  labels. `getByRole('button', { name })` finds nothing, and `check()` fails because the label
  intercepts the click. Click the label and assert `toBeChecked()` (Panel `chooseToggle()`, #177).
  Dependabot's lone vite-plus PR bumps only `vite-plus`, not the `vite` alias or `overrides.vite`,
  so it always fails `npm ci`: fold it into the combined deps branch.
- A Filament button made `disabled()` with a `tooltip()` renders `aria-disabled="true"` (no
  `disabled` attribute), and Playwright's `click()` waits on it until the test times out
  (150 s, "element is not enabled"). Before pushing such a change, grep **all** of `tests/e2e`
  for the button's name, without a `head` cutting the list short: Panel #3963's grep stopped at
  40 lines and missed `signing.spec.ts`, which failed in CI.
- A new Filament form field whose label contains an existing one ("Public headline" next to "Headline") breaks
  every older spec that uses `getByRole('textbox', { name: 'Headline' })` (strict mode, 2 elements) but
  not the new spec: add `exact: true`, and grep `tests/e2e` for the old label before pushing (Panel #3087).
- A required-field asterisk inside a `<label>` (even `aria-hidden`) breaks `getByLabel(name, { exact: true })`:
  Playwright matches the label's text, asterisk included, though the accessible name is unchanged. Use
  `getByRole('combobox', { name, exact: true })` (Panel `apply.spec.ts`, #3970). A Filament modal footer button
  named "Close" clashes with the modal's corner X (also "Close"): scope it to `.fi-modal-footer`. A hidden
  submit (`modalSubmitAction(false)`) doesn't stop `callAction()` or a crafted Livewire call, so the action
  class must still refuse; `replaceMountedAction(name, context: ['schemaComponent' => 'infolist.<key>'])` in
  an extra footer action swaps the dialog for a section's action (Panel #3972).
- A long parallel Playwright run on this PC can end with `net::ERR_NO_BUFFER_SPACE` console
  errors (Windows socket exhaustion, ~10 min in). Rerun the failed specs alone before blaming
  the change (Panel #2801: 42/44, then 4/4).
- The first Filament page after `php artisan serve` starts can take over 5 s here, so whichever
  spec lands on `/staff` first after the 2FA challenge can fail `toHaveURL`: give that assertion
  15 s. Filament `assertActionHidden(TestAction::make(x)->table($record))` fails with "Record [n]
  no longer exists" when the active tab's query leaves the record out: assert on a tab that
  includes it (Panel #3203).
- Inertia SSR with a non-default port (AniTrack: 13721): `inertia:start-ssr` passes only its own
  process env to Node, and with the config cached (Forge deploys) Laravel never loads `.env`. So
  `INERTIA_SSR_PORT` never reaches `ssr.js`, Node listens on 13714 while Laravel calls the cached
  13721, and every page silently falls back to an empty `#app`; `inertia:stop-ssr` misses it too.
  The Forge daemon command sets it: `/usr/bin/env INERTIA_SSR_PORT=13721 php8.4 artisan
  inertia:start-ssr`. The daemon log (`~/.forge/daemon-<id>.log`) prints the port. With
  zero-downtime deploys `stop-ssr` must come after `$ACTIVATE_RELEASE()` (AniTrack #4272, Nov 10).
- Blade compiles directives before echoes, even inside `{!! !!}`: a JSON-LD key `'@context'` there
  became Laravel's `@context` directive, so the live page source showed `<?php $__contextArgs…`
  (AniTrack #4456). Write `'@@context'`, and grep root views for `'@` keys in other apps.
- `/version` pages (#4445): MDG's `App\Support\DeployedVersion` reads `.git` with plain file reads
  (Forge pulls `main` in place); the route uses `->withoutMiddleware('web')` so it sets no cookie.
  Copy both to the other Forge apps. Now live on MDG, mcpacks, Panel and AniTrack; AniTrack's
  zero-downtime release folders keep `.git`, so it works there too (#4453).
- Sentry issues can arrive as Triage cards ("Sentry Error ANITRACK-1J", body = the Sentry
  page, too big for `get_card`'s output: parse the saved file with Node). Before merging more
  to that app, compare the issue's first-seen time with the last deploys' `/version`
  `deployed_at`. An `Anime::upsert` (any Eloquent `upsert`/query update) skips model events, so
  anything a `saving` hook fills (AniTrack slugs) stays empty: backfill after the upsert, and
  seed such rows in E2E with a query update (AniTrack #4505).
- `cmd && tail` reports tail's exit code, so a failed `npm run check` piped into tail still let a
  push go ahead. Run checks on their own (or `set -o pipefail`) before pushing (Panel #3203).

**Android (Kotlin + Gradle)**
- Set `JAVA_HOME` to JDK 21 before `./gradlew`: Gradle < 9 dies on JDK 25 with a bare "25.0.2" error.
- CI on `ubuntu-latest`: build job (lint, unit tests, debug + release APKs) and an E2E job that
  enables KVM and runs `connectedDebugAndroidTest` + an install-and-launch smoke test of the
  minified release APK via `reactivecircus/android-emulator-runner` (`google_apis` image, since fused
  location needs Play services). Locally, use a Gradle managed device; AGP downloads the image.
- **Never run `connectedAndroidTest` on Shay's phone**: AGP uninstalls the app afterwards, wiping
  its data. Instrumented tests should `assumeTrue(isEmulator)` before touching DB/prefs.
- Unsigned APKs can't be installed. Releases are signed with the repo's (public) debug keystore so
  they update over existing installs; changing the signing key forces an uninstall (data loss).
- Never use a self-hosted runner on a public repo: fork PRs would run on that machine.
- CI emulator flake: the cold-booted Pixel Launcher can ANR, and its dialog steals focus, so every
  Espresso test fails with `RootViewWithoutFocusException`. Before the tests, run
  `settings put global hide_error_dialogs 1` and force-stop `com.google.android.apps.nexuslauncher`.
  On failure, dump `mCurrentFocus`, ANRs/crashes from logcat, and a screenshot (World Explorer `ci.yml`).
  `android-emulator-runner` runs each `script:` line on its own, so a `|| { …; }` block must stay on one line.
  A second cold-emulator flake: `com.google.android.gms.persistent` ANRs and `setMockMode` fails
  with "Timed out waiting for Task" (`MainActivityE2ETest`). Check for it in the `e2e-reports`
  artifact and rerun once before you debug (#26, Nov 9). If it comes back, open a card.
- Reproducing boot/reboot bugs: the Gradle managed device can't be rebooted, so copy its
  `config.ini` (`~/.android/avd/gradle-managed/...`) into a scratch AVD dir, drop the
  `disk.dataPartition.path = <temp>` and `fastboot.*` lines, and boot it with `ANDROID_AVD_HOME`
  pointing there (write the `.ini` `path=` with forward slashes). After `pm grant`, wait ~30 s and
  `adb shell sync` before `adb reboot`, or the grants are lost. Don't touch the managed AVD itself.
- Checking dialog order by hand: `uiautomator dump` shows only the top window, so a dialog
  stacked underneath stays hidden. List every window with
  `adb shell dumpsys window windows | grep "Window #"`. Change `font_scale` during a prompt
  to test activity recreation (a duplicate permission request logs "Can request only one set
  of permissions at a time").
- Git Bash: turn `$LOCALAPPDATA` into a POSIX path with `cygpath -u` before adding it to `PATH`, and
  set `MSYS_NO_PATHCONV=1` for `adb shell` commands with `/sdcard/...` paths.
- Minor-versioned platforms (Android 17 = `android-37.0`, 16 QPR = `36.1`): AGP's managed device
  resolves `apiLevel = 37` to the `37.0` image itself, but `android-emulator-runner` interpolates
  `api-level` verbatim into `platforms;android-X` / `system-images;android-X;…`, so the workflow
  needs `api-level: '37.0'` **quoted**: a bare `37.0` is YAML's number 37 and `android-37` doesn't
  exist (first CI run failed). Set `pageAlignment = FORCE_4KB_PAGES` on the managed device, or AGP
  warns on every build that it can't tell the 37.0 image's page size (World Explorer #2711).
- Emulators on this PC (the managed device too) get no working DNS, so the network never
  validates: OSM tiles fail and DownloadManager waits forever, even for a 127.0.0.1 URL. Boot a
  scratch emulator with `-dns-server 8.8.8.8` (launch it with `exec` in a `run_in_background`
  Bash call; `&` inside a call is fragile). CI emulators are fine.
- `appops set <pkg> REQUEST_INSTALL_PACKAGES deny|default` kills the app's process and the
  instrumentation with it ("Test failed with status -1", rest of the class skipped). Fake the
  permission with a debug-only override instead. To check app data survives an update of a
  release (non-debuggable) build, use `adb root` + `/system/bin/sqlite3` on a google_apis image;
  `run-as` doesn't work there. A slow emulator can turn Espresso's `click()` into a long press:
  use `performClick()` via `scenario.onActivity` (World Explorer #3355).

**Built-in browser on an unattended run.** The pane may never draw (viewport 0x0, then "Could not
get the tab ready for input" on clicks). `read_page`, `find`, `form_input`, `get_page_text` and
`javascript_tool` still work: fill fields with `form_input` and submit with
`form.requestSubmit()` or a button `.click()` in `javascript_tool`.
Inertia apps (Laravel starter kits) are the exception: after an XHR submit (2FA challenge,
login into a Filament panel) the undrawn pane never follows the redirect. Drive those flows
with a throwaway Playwright spec instead (headless Chromium, screenshots to the scratchpad),
never committed (Panel #2787).
`preview_start` by `name` only reads the session folder's `.claude/launch.json` (this control
repo, which has none), not the project's. Start the project's server with Bash
(`run_in_background`, throwaway DB, spare port), open it with `preview_start({url})`, and stop
it by port afterwards (`Get-NetTCPConnection -LocalPort <n>` → `Stop-Process`).

**Updating a PR branch after another PR merged.** Don't force-push a rebase. Rebase locally and test,
then push a merge commit with that exact tree on top of the remote branch:
`git commit-tree $(git rev-parse HEAD^{tree}) -p origin/<branch> -p main`.
`gh pr merge` can answer "502 Bad Gateway" and leave the PR open (Panel #146, Nov 4): check
`gh pr view <n> --json state` before moving on, and run the merge again. `git push` can fail the
same way ("remote rejected … (Internal Server Error)"); a `push -q … | tail` hides it and the
next `gh pr create` fails with "Head sha can't be blank": push without `-q`, retry (Panel #149).
`gh pr create` can answer "GraphQL: Something went wrong" / 502 several times in a row and still
create the PR on one of them: before each retry, `gh pr list --head <branch>` (Panel #162, Nov 5:
five errors, one PR). The same afternoon a PR's run ended `startup_failure` ("likely failed because
of a workflow file issue") with no workflow change, and the next push made no run at all: check
`githubstatus.com/api/v2/components.json` (Actions "degraded_performance") before debugging the
workflow, then push again once it recovers (Panel #164). Nov 9 (Actions "major_outage"): the
self-hosted runner's PRs (Panel #178/#179) ended "workflow file issue" with zero jobs while
GitHub-hosted AniTrack CI passed; `gh run rerun <id>` once Actions was "operational" ran them fine.
After squash merges the old ancestry is gone, so `git merge main` into a sibling or stacked PR
conflicts on files it never touched. Take the PR's own diff instead
(`git diff $(git merge-base origin/main <branch>) origin/<branch>`, or against its old stacked base),
`git apply --3way --index` it onto a worktree of main, resolve, test, then `commit-tree` that tree
with parents `origin/<branch>` and `origin/main` (Panel #61/#62, Oct 26).
Panel's E2ESeeder, `tests/e2e/fixtures.ts`, `routes/console.php` and CLAUDE.md conflict on every
parallel card, always additively. `node scripts/union-merge.mjs <files>` (keep both sides, ours
first) handles most of it, but check each seam: when both sides end just before a shared `}` the result loses a brace.

**Swapping a UI library for local components** (AniTrack #4272): before touching code, run a
throwaway Playwright spec on main's build that takes full-page screenshots and dumps
`getComputedStyle` (box, padding, border, colours, font, shadow) of every control, plus hover,
focus and the states that need data (create a token, a playlist; switch flags on with the app's
own service via `php artisan tinker` on the E2E database). Build the components from those
numbers, capture again and diff the JSON: it finds what the eye misses (a missing
`type="text"`, a variant only shown with data). Feature-flagged pages 404 in E2E until switched on.
A styled theme also sets page-wide CSS: PrimeVue Aura's `.dark { color-scheme: dark }` kept the
native date-picker icons light, and dropping the package dimmed them. Dump `html`/`body` computed
styles (`color-scheme`, font) too, and diff full-page screenshots of main's build (built in a
scratch worktree, copied over `public/build` for the capture) against the branch's (AniTrack #4272).
Overlays (Select lists, dialogs) on an SSR app: `<Teleport v-if="mounted">` set in `onMounted`,
so the server HTML and hydration agree.
Stack the teleported layers on purpose: a Select list at z 1001 opened *under* the Dialog mask
(1101), so the Status dropdown in a dialog showed nothing, while keyboard-only E2E still passed.
Pick options with a mouse `click()` inside dialogs too: Playwright refuses a covered element
("… intercepts pointer events") (AniTrack #4329).

**Screenshots in PRs.** `gh` can't upload images. Commit them to an orphan `pr-assets` branch in the
app repo (`git hash-object -w` → `git mktree` → `git commit-tree` → `git push origin <sha>:refs/heads/pr-assets`,
one folder per card) and embed `https://raw.githubusercontent.com/<repo>/pr-assets/<card>/<file>.png`.
Private repos (Panel, GroundStation, Obsidian): raw.githubusercontent images don't load there, so
embed `https://github.com/<repo>/blob/pr-assets/<card>/<file>.png?raw=true` (Panel #3602).
`main` stays image-free. Capture with a temporary Playwright spec that is never committed, and point
any file browser at a temp dir, never Shay's home folder.
Give Node/Playwright a Windows path (`C:/Users/...`), not Git Bash's `/c/Users/...`: Node reads
that as a path on the current drive and wrote the screenshot to `E:\c\Users\...` (Panel #3535).
Guard the script (`set -e`, `test -n "$c"`, feed `git mktree` from a file): if `git commit-tree`
fails, `git push origin $c:refs/heads/pr-assets` becomes `:refs/heads/pr-assets` and **deletes**
the branch (happened on nexus-ssh, restored at once from the fetched commit). Push only after
`git merge-base --is-ancestor origin/pr-assets $c`.

**Backslashes reach Markdown and PHP tests too** (Panel #3084): the same loss hits CLAUDE.md sections and test files written via heredoc/`node -e`. Write them with the Write tool. Also: `cat > file` without a heredoc waits on stdin forever (add `</dev/null`), but never add
`</dev/null` to a `cat > file <<EOF` line: the later redirect replaces the heredoc and writes an empty
file (a throwaway spec came out empty, "No tests found", Finance #3387). And `../..` log paths from a project folder land in `E:`: log into the scratchpad.

**Editing PHP from the shell.** `sed` replacement strings and heredocs fed to `node -e` / `node -`
lose the `\` in PHP namespaces: the replace silently matches nothing, or writes `AppRbacAccess`
for `App\Rbac\Access`. Edit PHP with the Edit/Write tools (or a quoted `cat <<'EOF'` heredoc that
writes the whole file). Happened in three runs on Oct 19.
The same goes for anything with a backslash in a `node -e '…'` script: regexes in TypeScript
(`/\/staff$/` became `//staff$/`, a comment, and a `.replace` matched nothing), and a
zero-width space slipped into a class name once. Use Edit for those too, then `grep` for the
change and for non-ASCII (`grep -nP '[^\x00-\x7F]'`).
Even a quoted `cat <<'EOF'` heredoc isn't byte-exact here: single `\` survive, but `\\` arrives
as `\` (checked with `od -c`). So a heredoc-written PHP file is fine, while a JS/TS helper script
that escapes backslashes (`'App\\Models'`) silently loses them (Panel #2788).
For a multi-replace edit script, write the `.mjs` with the Write tool into the scratchpad and run
it with `node <path>`: Write keeps every byte. Give it a `rep(a, b)` that throws when `a` isn't
found, so a mangled pattern stops the script before it writes anything (Panel #2795).
`rep` must also refuse a pattern that matches **more than once** (`s.split(a).length !== 2`): `replace`
edits the first match only. A field meant for Edit engagement landed in End engagement's form (both
`->schema([ DatePicker::make('end_date')`), and a line meant for a new test changed an older one (Panel #3975).
Inside `rep`, use `s.replace(a, () => b)`, not `s.replace(a, b)`: in a replacement string
`` $` `` / `$&` / `$'` are special, so a template literal ending in `` ${id}$` `` (a regex
anchor) pasted the whole file into the spec (Panel #3983).

**Parallel branches in one repo.** While subagents edit the main checkout, a second card can go in a
`git worktree add` under the scratchpad (never a top-level folder here: the next run would onboard it),
with its own `pnpm install`. `git worktree remove` fails on Windows with "Filename too long" in
`node_modules`: delete the folder with `cmd /c rmdir /s /q "\\?\<path>"`, then `git worktree prune`.
Run that from PowerShell: in Git Bash, MSYS rewrites `/s` and `/q` into paths ("Parameter format not
correct") unless `MSYS2_ARG_CONV_EXCL='*'` is set (Panel #3980, Nov 3). Write the literal path:
a `"\\?\$wt"` built from a variable is refused by a safety check (an empty variable would target `\\`).

**Stacking a branch on an open PR.** `gh pr merge --squash --delete-branch` also deletes the local
branch, so `git rebase --onto main <old-branch>` fails afterwards. A squash keeps the same tree,
so commit the stacked work, then `git reset --soft main` and commit again: the index holds only
the stacked changes. Run `git add -A` and check `git status` before any such squash commit:
edits made after the last `git add` are silently left out (Panel #3201: a Pint fix and CLAUDE.md
missed the push, CI went red on Pint).
A stacked PR whose base is the first PR's branch is **closed for good** when that branch is
deleted on merge (GitHub did not retarget it, and a closed PR can't change base or reopen:
Nexus #36 → #37). Before merging the base PR, `gh pr edit <stacked> --base main` (the squash
leaves the same tree, so the diff stays the stacked changes only), or merge without
`--delete-branch`, retarget, then delete the branch.

**Secret scanning.** gitleaks via Docker. Bind-mounting `E:\` paths fails in this Docker setup, so
pipe the repo in:
`tar --exclude=./node_modules --exclude=./vendor -cf - . | docker run --rm -i --entrypoint sh zricethezav/gitleaks:v8.21.2 -c 'mkdir /repo && tar xf - -C /repo && git config --global --add safe.directory /repo && gitleaks git /repo --no-banner && gitleaks dir /repo --no-banner'`.
Don't pass `-v` to the `dir` scan — it prints secrets from local `.env` files into the transcript.

**Docker on this PC.** The active `docker context` is `xwave-remote` (an SSH host that times out
from here), so a bare `docker` command fails. Use the local engine with `DOCKER_CONTEXT=desktop-linux`
(per command or exported; don't `docker context use`, that's Shay's setting). Docker Desktop may
not be running on an unattended night: `Start-Process "C:\Program Files\Docker\Docker\Docker
Desktop.exe"` and poll `docker info` (≈5–30 s). On Oct 30 it never came up in two runs (even
`docker version` hung), and on Oct 31 the process was running but the engine still hung
(`docker version` timed out) for a whole afternoon of runs. Give it ~5 minutes, then push and
let CI's Postgres/MySQL job run the E2E, and say on the PR and card that local E2E didn't run
(Clerq #74, #77, #78). Check in CI's E2E log that the new spec actually ran. For a Redis-backed test, start
`redis:7-alpine` on a private network with no published port and run the suite in a node
container on that network (GroundStation #2564: `REDIS_URL=redis://gs-redis:6379`).

**Docker ports.** Published container ports (e.g. GroundStation's compose MySQL on 3307) are not
reachable from the host here (ECONNREFUSED although healthy). Run DB tests inside a container on
the compose network, piping the repo in: `tar --exclude=./node_modules --exclude=./.git -cf - . |
docker run --rm -i --network groundstation_default node:24-bookworm-slim sh -c 'mkdir /app && tar
xf - -C /app && cd /app && npm ci --ignore-scripts && DB_DRIVER=mysql DB_HOST=mysql DB_PORT=3306
DB_USER=root DB_PASSWORD=root node tests/run.js <files>'`. Baseline against `git archive main` the
same way. `docker compose stop` afterwards.
Treat ports published on `0.0.0.0` as reachable from outside this PC: a ransom bot wiped
GroundStation's root/root MySQL container on 3307 (Oct 2026, card #2635). Dev compose files
publish on `127.0.0.1` only, and nothing needs the published port anyway (see above). If a
DB container shows a `RECOVER_YOUR_DATA`-style database or stripped grants, stop it, look
before deleting anything, and flag it to Shay.
GitHub Actions on the self-hosted runner: a job `container:` breaks every JS action
(`/__e/node24/bin/node: no such file`). Check out on the runner and pipe the tree into
`docker run --network ${{ job.services.<id>.network }}` instead (GroundStation `ci.yml`);
`--tmpfs /var/lib/mysql` in the service options makes the MySQL suite ~5x faster.

**Downloads page redeploys.** GitHub Pages' CDN caches the page for up to 10 minutes
(`Cache-Control: max-age=600`), and a `?t=` query string does not get past it. After a successful
`pages.yml` run, check `curl -sI` `Last-Modified` (it should be after the deploy time) or retry for
~10 minutes before deciding the rebuild failed. Two deploys a few minutes apart can fail with "in
progress deployment. Please cancel … first". That's harmless if the earlier deploy has the new release.

**Card ids.** Cards and comments share one id sequence, so you can't predict a new card's number.
Create the card first, then mention its id in other comments.
Comments are sanitized HTML: an angle-bracket placeholder like `<email>` disappears, even inside backticks. Write a concrete example (`you@example.com`) or `&lt;email&gt;`.

**Card ordering note.** An L card that's been split stays in Ready *on hold* as the tracker. It is
not picked up by the build step, and it moves to Done once all its pieces are released.

## Weekly maintenance (Monday run, before the release train)

- Review and merge green Dependabot PRs (patch/minor); majors become cards.
  A `@dependabot rebase` on a stale *group* PR can come back "updatable in another way": it closes
  that PR and opens a new, bigger group. Look for the new number instead of waiting (Clerq #80,
  ProjectTrucks #47). On ShayPunter/million-dollar-challenge it got no answer at all:
  `gh pr update-branch <n>` re-runs CI there.
  On a repo whose CI runs on the self-hosted runner (Panel: ~20 min a run, one job at a time),
  don't merge eight lockfile PRs one by one: do one `chore(deps)` branch with all the patch/minor
  bumps, run CI once, merge, then `gh pr close` the superseded ones (Panel #116, Nov 2).
  `gh run rerun --failed` on a `pull_request` run reuses its old merge commit: after another PR
  merged in the meantime it does not test the combined tree. Wait for main's own CI after the merge.
- Tests that build dates with Carbon `subMonths()` / `addMonths()` overflow at month end
  (Oct 31 − 6 months = May 1), so date-relative tests go red on the 29th–31st and every Dependabot
  PR opened then looks broken. Use the `NoOverflow` variants or freeze the clock (Obsidian #3837).
  Month arithmetic can't reach every date: with a 6-month window no anchor expires on Oct 31,
  whichever form you use, so an "expiring in N days" factory fails on the **28th** too. Freeze
  the clock. And overflowing `addMonths` isn't monotonic (Aug 31 + 6 = Mar 3, Sep 1 + 6 = Mar 1):
  a shown date from `addMonths` with a cleanup cutoff from `subMonths` deleted packs before
  their shown date. Use NoOverflow on both sides.
- Deploys without a hashed asset: GroundStation's `/version` commit (#4454); for a Forge app whose bump leaves the hash unchanged, `/build/manifest.json`'s
  `Last-Modified` still moves (MDG, Nov 2).
- Forks (registry `upstream`, e.g. Arkeep): if upstream has a newer release than our last
  `-pd` base, open a `claude/sync-vX.Y.Z` PR merging that tag (merge commit), then release
  `vX.Y.Z-pd.1` on the train. A conflict with one of our patches becomes a card.
- Check the last CI run on each `main` is green; investigate red.
- `npm audit` (or equivalent) — high/critical findings become `bug` cards.
- Dependabot runs that fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` aren't config bugs: its release-age
  gate refuses versions only a day or two old, which a fresh direct-dependency bump (e.g. `^44.9.0`)
  forces. They clear by themselves (Nexus, Oct 2026).
- Transitive audit fixes: `pnpm up <pkg> --depth Infinity` works on pnpm 10 (ProjectTrucks), but on
  pnpm 11 (Clerq) it, an `overrides` entry in `pnpm-workspace.yaml`, and a remove/re-add of the parent
  all left vite 8.0.16 in the lockfile ("Already up to date", unmet peer warning), though a fresh
  pnpm 11 install resolves 8.3.5. The cause: vite is a *peer* of vitest (it shows in the snapshot key,
  `vitest@4.1.8(...)(vite@8.0.16(...))`), and pnpm keeps a resolved peer. Adding it as a direct
  devDependency (`pnpm add -D vite@^8.3.5`) lifted it at once (Clerq #71). Check `pnpm why` first.
  pnpm 10 does the same when a major turns a dependency into an optional peer: Vite 8 left
  esbuild 0.27.7 (low advisory) in ProjectTrucks' lockfile, and `pnpm up --depth Infinity` /
  `pnpm dedupe` didn't lift it (#3844).
- Node image majors (`node:24-alpine` → `26-alpine`): Node 25+ no longer ships corepack, so a
  Dockerfile's `corepack enable` fails. CI that doesn't build the image stays green on the
  Dependabot PR. Install it first (`npm install -g corepack@<v> && corepack enable`) and build
  the image locally before merging (Clerq #3273).
- Check a major's licence before merging, even with green CI: `npm view <pkg>@<v> license`
  (and the tarball's LICENSE). PrimeVue 5 went from MIT to a commercial PrimeUI licence that
  needs a key (`@primeui/license-manager` dependency); a licence change is Shay's call (AniTrack #4252).
- TypeScript 7 (the native compiler) has no JS compiler API, so `vue-tsc` can't run on it
  ("typescript/lib/tsc" not exported). Projects with vue-tsc stay on TS 6.0 (the last JS release)
  with a Dependabot `ignore: typescript >=7` (AniTrack extension, #3820).
- Inertia 3 on an app with no published `config/inertia.php`: the package default turns SSR on
  and points page checks at lowercase `js/pages`, which can break `assertInertia()->component()`
  on Linux CI (unless the test passes `false` to skip the file check). Publish the config and set both (MDG #3821).
- If a run's log entry is missing, reconstruct what it did from `gh release list`, open `claude/*`
  PRs and the board's latest `🤖 Claude:` comments before carrying on (the Oct 26 00:xx train
  released five apps, opened three PRs and logged nothing).
- Tauri apps: Dependabot's separate npm and cargo minor groups each fail `tauri build` ("mismatched
  Tauri packages"), because `@tauri-apps/*` and the `tauri*` crates must move together. ProjectTrucks'
  Dependabot now ignores Tauri minor/patch bumps: bump both sides by hand in one PR each Monday
  (recipe in its `CLAUDE.md`, "Dependency updates") (ProjectTrucks #2879).
- The release train is a good fit for parallel sub-agents (one per project, release + maintenance,
  no board writes); the parent moves cards and rebuilds the downloads page once at the end.
  Nov 2: seven agents (the two Forge Laravel apps paired, the two private repos paired) plus Panel
  in the parent finished ten projects in ~80 minutes. Expect macOS hosted runners to queue 10–15
  min when several apps release at once, and local E2E to time out on logins while the agents
  build: rerun alone or trust CI.
  Nov 9: seven agents (Panel deps as one of them) took ~45 min. Agents hand back while their
  release workflow still runs (a sub-agent's foreground wait goes to the background after
  ~3 min). So the parent `gh run watch`es the run itself (`run_in_background`) and checks the
  assets before it moves any card. Tell agents to wait with `run_in_background` or Monitor.
- A Dependabot "dev" group that bumps `electron` changes the shipped runtime, so it gets a patch
  release (Finance v0.6.1).
- On every repo, put all open patch/minor Dependabot PRs into one `chore(deps)` branch (in-range
  `composer update -W` / `npm update`), not one merge each. That gives one CI run and, on Forge or
  Publish apps, one production deploy, and Dependabot closes the old PRs by itself
  (Obsidian #54, GroundStation #105, Nov 9).
- AniTrack's `git fetch --tags` exits 1 ("would clobber existing tag"), because the
  extension dev build moves `extension-dev-latest`. Use `--force`.
- A crashed run leaves `ops/run.lock` and possibly uncommitted work on a `claude/*` branch. When
  the lock is stale and no session is running, take the lock, `git add -A && git commit` the WIP on
  that branch before any other git command, then finish the card from there (Panel #3600, Nov 2).

## Permissions

Scheduled runs cannot ask for approval. If a run is blocked by a permission prompt/denial, record it in
`ops/permission-requests.md` (tool, exact command, why it was needed, how often) and push-notify Shay.
Shay approves from an interactive session in this folder, which then updates `.claude/settings.json`.

## Rules of engagement

- Never force-push, delete repos, delete releases, or rewrite published history without Shay's OK.
- Never commit secrets. Never put credentials in GroundStation comments.
- Dev containers (compose files, `docker run -p`) publish ports on `127.0.0.1` only, never
  `0.0.0.0`: this PC is reachable over IPv6 (Shay, #2635). Fix any managed project that doesn't.
- Never mark something done that wasn't verified. If E2E couldn't be done, say so on the card.
- Never run `git checkout -- .` / `git restore .` / `git stash` "to be safe" in a project with
  uncommitted work: it threw away a whole card's edits mid-run (GroundStation #3054; redone
  from the scratchpad edit scripts). Keep edits as idempotent `.mjs` scripts in the scratchpad
  until they're committed, and commit WIP before any tree-wide git command.
- Keep comments short and useful; one comment per state change.
- If this playbook is wrong or incomplete, fix it in the same run and mention it in the run log.
