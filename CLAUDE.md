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
  except native **Android** apps (e.g. World Explorer), which ship a sideloadable `.apk` per release.
- **Signing.** Builds are unsigned. The downloads page explains the SmartScreen / Gatekeeper bypass.
- **Repo owner.** App repos default to `PunterDigital`, but Shay may keep one on his personal account
  (`ShayPunter/…`). The registry `repo` field is authoritative; don't transfer without asking.
- **Machine.** Windows 11, Node 24, git, gh, PHP 8.3 (default) and 8.4 + Composer (via pvm; the
  `composer` shim always uses 8.3, so for 8.4 run `php <8.4 dir>/composer/composer.phar`), Docker. No .NET SDK.
  Cannot run macOS builds locally — macOS is verified by CI only. Android SDK (with emulator) in
  `%LOCALAPPDATA%\Android\Sdk`; JDK 21 at `C:\Program Files\Java\jdk-21.0.11` (`JAVA_HOME` points at
  Android Studio's JDK 25 JBR, which older Gradle can't run on). No Python: `python3` is the
  Windows Store stub and hangs the shell until timeout. Use Node for scripts.

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

**Tags.** Project tags (lowercase, e.g. `nexus ssh`) map to `projects.json[].tag`. Status tags Claude
manages: `claude` (Claude owns it), `needs answer` (question pending for Shay), `blocked` (Claude
cannot proceed — reason in comments), `bug`, `hotfix` (ship immediately), `size: s|m|l`,
`priority: low|medium|high|critical`.
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

Runs every 3 hours, 09:00–21:00 local. Each run:

0. **Lock.** If `ops/run.lock` exists and is < 3h old, another run is active: log and exit. Otherwise
   write the lock (timestamp) and delete it at the end, success or failure.
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
   Shay also comments on cards in other columns (objections on Ready cards, notes on In Progress).
   Read the full comment thread of any card before you build, merge or release it, and act on any
   un-prefixed comment newer than Claude's last one.
5. **Triage.** Every card in *Triage* (see **Triage rules**).
6. **Build.** Take the top card from *Ready*: `hotfix` / `priority: critical` > `high` > `medium` >
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

## Release cadence

- **Weekly release train:** the first run on **Monday** releases every project that has cards in
  *Awaiting Release* (or other unreleased commits on `main`).
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

## Onboarding a new project folder

1. **Inspect.** Stack, build system, how it runs, existing git remote, existing CI.
   - **Check the folder is its own repo:** `git -C <folder> rev-parse --show-toplevel` must print the
     folder itself. If it prints the control-repo root, the folder has no `.git` and every git command
     would hit the control repo — run `git init -b main` in the folder first.
   - Shay may name a project that has no folder yet: find it with `gh repo list PunterDigital`
     (and `ShayPunter`) and `git clone` it into a top-level folder of that name.
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
  "Restart to update", and delete `%LOCALAPPDATA%/<app>-updater` afterwards.
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
  (ProjectTrucks `release.yml`).

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
- The self-hosted runner runs one job at a time. Turning on Dependabot opens a burst of PRs whose
  CI fills the queue, so a release tag pushed right after onboarding can wait 10+ minutes. Push
  the tag before enabling Dependabot, or expect the wait.
- **GroundStation** (`groundstation/`) is the app this board and the GroundStation MCP connector
  run on. A merge to its `main` redeploys the pipeline's own board, so after every merge check
  the live site *and* that an MCP call still answers before carrying on with the run.

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

**Laravel web apps (Forge-hosted)**
- No desktop builds: CI is one ubuntu job (Pint, `npm run build`, Pest, Playwright E2E). Forge
  auto-deploys `main` on push, so every merge is a production deploy; check the live site after.
  A release is a tag + GitHub Release with notes; registry entry is `platforms: ["web"]` + `webUrl`.
- `phpunit.xml` must force in-memory SQLite: Breeze's Pest suite uses `RefreshDatabase` and would
  otherwise wipe the `.env` database.
- Feature tests render Blade and need the Vite manifest: build assets before `php artisan test`.
- E2E: Playwright `webServer` runs `php artisan serve` with env-var overrides (env beats `.env` in
  Laravel) pointing at a throwaway SQLite file. Reset that file inside the webServer command, not at
  the top of `playwright.config.js` — workers re-load the config after the server has migrated.
  A stale `public/hot` makes pages load from a dead Vite dev server (blank page): delete it.
- `pint` isn't always idempotent; run `pint --test` after `pint`.
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
  skips CSRF, so only E2E (or a real caller) catches it (Panel #2799).
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
- After rebasing a branch, run `npm run build` again before E2E: a stale `public/build` from before
  the rebase makes Playwright fail on UI that is already in the code.
- Vite+ (`vite-plus`, the starter kits' toolchain) ≥ 0.3.3 needs `vite` aliased to
  `npm:@voidzero-dev/vite-plus-core@<same version>` (plus an `overrides.vite` for the plugins'
  peers). Upgrading it with npm: the old lock keeps `vite@8` on top and npm fails with a
  misleading `@vue/language-core` peer conflict; delete the toolchain entries from
  `package-lock.json` and reinstall. `vp migrate` switches the project to pnpm (reverted). Vite+
  1.x also needs vue-tsc 3.2/3.3: 3.3.12–3.3.13 break `types:check` on any `https://` in a
  template attribute (vuejs/language-tools#6240), so Panel pins 3.3.11 (Panel #2801).
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
- Panel uses `data-test` attributes, not `data-testid`: Playwright `getByTestId` finds nothing, use `locator('[data-test="x"]')`. A new Bash call falls back to PHP 8.3 unless the 8.4 `PATH` export is repeated (Panel #3082).
- A new Filament form field whose label contains an existing one ("Public headline" next to "Headline") breaks
  every older spec that uses `getByRole('textbox', { name: 'Headline' })` (strict mode, 2 elements) but
  not the new spec: add `exact: true`, and grep `tests/e2e` for the old label before pushing (Panel #3087).
- A long parallel Playwright run on this PC can end with `net::ERR_NO_BUFFER_SPACE` console
  errors (Windows socket exhaustion, ~10 min in). Rerun the failed specs alone before blaming
  the change (Panel #2801: 42/44, then 4/4).

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

**Screenshots in PRs.** `gh` can't upload images. Commit them to an orphan `pr-assets` branch in the
app repo (`git hash-object -w` → `git mktree` → `git commit-tree` → `git push origin <sha>:refs/heads/pr-assets`,
one folder per card) and embed `https://raw.githubusercontent.com/<repo>/pr-assets/<card>/<file>.png`.
`main` stays image-free. Capture with a temporary Playwright spec that is never committed, and point
any file browser at a temp dir, never Shay's home folder.
Guard the script (`set -e`, `test -n "$c"`, feed `git mktree` from a file): if `git commit-tree`
fails, `git push origin $c:refs/heads/pr-assets` becomes `:refs/heads/pr-assets` and **deletes**
the branch (happened on nexus-ssh, restored at once from the fetched commit). Push only after
`git merge-base --is-ancestor origin/pr-assets $c`.

**Backslashes reach Markdown and PHP tests too** (Panel #3084): the same loss hits CLAUDE.md sections and test files written via heredoc/`node -e`. Write them with the Write tool. Also: `cat > file` without a heredoc waits on stdin forever (add `</dev/null`), and `../..` log paths from a project folder land in `E:`: log into the scratchpad.

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

**Parallel branches in one repo.** While subagents edit the main checkout, a second card can go in a
`git worktree add` under the scratchpad (never a top-level folder here: the next run would onboard it),
with its own `pnpm install`. `git worktree remove` fails on Windows with "Filename too long" in
`node_modules`: delete the folder with `cmd /c rmdir /s /q "\\?\<path>"`, then `git worktree prune`.

**Stacking a branch on an open PR.** `gh pr merge --squash --delete-branch` also deletes the local
branch, so `git rebase --onto main <old-branch>` fails afterwards. A squash keeps the same tree,
so commit the stacked work, then `git reset --soft main` and commit again: the index holds only
the stacked changes.
A stacked PR whose base is the first PR's branch is **closed for good** when that branch is
deleted on merge (GitHub did not retarget it, and a closed PR can't change base or reopen:
Nexus #36 → #37). Before merging the base PR, `gh pr edit <stacked> --base main` (the squash
leaves the same tree, so the diff stays the stacked changes only), or merge without
`--delete-branch`, retarget, then delete the branch.

**Secret scanning.** gitleaks via Docker. Bind-mounting `E:\` paths fails in this Docker setup, so
pipe the repo in:
`tar --exclude=./node_modules --exclude=./vendor -cf - . | docker run --rm -i --entrypoint sh zricethezav/gitleaks:v8.21.2 -c 'mkdir /repo && tar xf - -C /repo && git config --global --add safe.directory /repo && gitleaks git /repo --no-banner && gitleaks dir /repo --no-banner'`.
Don't pass `-v` to the `dir` scan — it prints secrets from local `.env` files into the transcript.

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
- Check the last CI run on each `main` is green; investigate red.
- `npm audit` (or equivalent) — high/critical findings become `bug` cards.
- Dependabot runs that fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` aren't config bugs: its release-age
  gate refuses versions only a day or two old, which a fresh direct-dependency bump (e.g. `^44.9.0`)
  forces. They clear by themselves (Nexus, Oct 2026).
- Tauri apps: Dependabot's separate npm and cargo minor groups each fail `tauri build` ("mismatched
  Tauri packages"), because `@tauri-apps/*` and the `tauri*` crates must move together. ProjectTrucks'
  Dependabot now ignores Tauri minor/patch bumps: bump both sides by hand in one PR each Monday
  (recipe in its `CLAUDE.md`, "Dependency updates") (ProjectTrucks #2879).
- The release train is a good fit for parallel sub-agents (one per project, release + maintenance,
  no board writes); the parent moves cards and rebuilds the downloads page once at the end.

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
