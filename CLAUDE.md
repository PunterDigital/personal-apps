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
- **GitHub.** Org `PunterDigital` (free plan; Shay is admin). All app repos are **public** (unlimited
  Actions minutes, incl. macOS runners). Licence: MIT unless the project already has one.
- **Platforms.** Priority order: **Web**, **Windows**, **macOS**. No Linux/mobile unless a card asks,
  except native **Android** apps (e.g. World Explorer), which ship a sideloadable `.apk` per release.
- **Signing.** Builds are unsigned. The downloads page explains the SmartScreen / Gatekeeper bypass.
- **Repo owner.** App repos default to `PunterDigital`, but Shay may keep one on his personal account
  (`ShayPunter/…`). The registry `repo` field is authoritative; don't transfer without asking.
- **Machine.** Windows 11, Node 24, git, gh, PHP 8.3 + Composer (via pvm), Docker. No .NET SDK.
  Cannot run macOS builds locally — macOS is verified by CI only. Android SDK (with emulator) in
  `%LOCALAPPDATA%\Android\Sdk`; JDK 21 at `C:\Program Files\Java\jdk-21.0.11` (`JAVA_HOME` points at
  Android Studio's JDK 25 JBR, which older Gradle can't run on).

## Board (Personal Apps card table)

| Column | id | Meaning |
|---|---|---|
| Triage | 23 | New cards. Untouched by Claude until triaged |
| Not Now | 24 | Triaged as "later" — deliberately parked, with a reason comment |
| Needs Info | 25 | Waiting on Shay; questions are in the comments; card tagged `needs answer` |
| Ready | 26 | Triaged, clear, sized; next to be picked up |
| In Progress | 28 | Being built on a feature branch |
| Testing & CI | 29 | Built; local E2E testing and/or PR pipelines running |
| Awaiting Release | 30 | Merged to `main`; ships in the next release |
| Done | 27 | Released; final comment has version + download link |

**Tags.** Project tags (lowercase, e.g. `nexus ssh`) map to `projects.json[].tag`. Status tags Claude
manages: `claude` (Claude owns it), `needs answer` (question pending for Shay), `blocked` (Claude
cannot proceed — reason in comments), `bug`, `hotfix` (ship immediately), `size: s|m|l`.
Create tags on the fly with `add_card_tag` by name.

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
4. **Answers.** Cards in *Needs Info*: read comments. If Shay commented after Claude's latest question,
   remove `needs answer`, re-triage with the new info. If unanswered for 7 days, push-notify once.
5. **Triage.** Every card in *Triage* (see **Triage rules**).
6. **Build.** Take the top card from *Ready* (order: `hotfix` > `bug` > due date > oldest). Run the
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
     + planned approach in 1–3 lines. Tag `claude` and `size: x`.
   - **Needs Info** — real ambiguity that changes what gets built. Comment with numbered questions,
     each with Claude's recommended default ("If you don't mind, I'll do X"). Tag `needs answer`.
     Do not ask questions with obvious conventional answers — pick the default and note it.
   - **Not Now** — out of scope, huge, or blocked by something external. Comment the reason.
   - **L-size** → split into S/M cards (create_card, same tags, straight into Ready), comment on the
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
- **Hotfix:** cards tagged `hotfix`, or `bug`s that stop the app launching / lose data / are security
  issues → release immediately after merge.
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
   - Copied-in `node_modules` are usually broken (pnpm symlinks don't survive copies): delete and
     reinstall from the lockfile before judging whether the project builds.
   - Run the project's own build/typecheck/lint/tests first and record what's broken — that's the
     baseline for the audit.
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
- Run the E2E suite against the packaged app in CI, not just the dev build.
- `main` is branch-protected with required checks, so version bumps go through a PR too.
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
- Git Bash: turn `$LOCALAPPDATA` into a POSIX path with `cygpath -u` before adding it to `PATH`, and
  set `MSYS_NO_PATHCONV=1` for `adb shell` commands with `/sdcard/...` paths.

**Secret scanning.** gitleaks via Docker. Bind-mounting `E:\` paths fails in this Docker setup, so
pipe the repo in:
`tar --exclude=./node_modules --exclude=./vendor -cf - . | docker run --rm -i --entrypoint sh zricethezav/gitleaks:v8.21.2 -c 'mkdir /repo && tar xf - -C /repo && git config --global --add safe.directory /repo && gitleaks git /repo --no-banner && gitleaks dir /repo --no-banner'`.
Don't pass `-v` to the `dir` scan — it prints secrets from local `.env` files into the transcript.

**Card ordering note.** An L card that's been split stays in Ready *on hold* as the tracker. It is
not picked up by the build step, and it moves to Done once all its pieces are released.

## Weekly maintenance (Monday run, before the release train)

- Review and merge green Dependabot PRs (patch/minor); majors become cards.
- Check the last CI run on each `main` is green; investigate red.
- `npm audit` (or equivalent) — high/critical findings become `bug` cards.

## Permissions

Scheduled runs cannot ask for approval. If a run is blocked by a permission prompt/denial, record it in
`ops/permission-requests.md` (tool, exact command, why it was needed, how often) and push-notify Shay.
Shay approves from an interactive session in this folder, which then updates `.claude/settings.json`.

## Rules of engagement

- Never force-push, delete repos, delete releases, or rewrite published history without Shay's OK.
- Never commit secrets. Never put credentials in GroundStation comments.
- Never mark something done that wasn't verified. If E2E couldn't be done, say so on the card.
- Keep comments short and useful; one comment per state change.
- If this playbook is wrong or incomplete, fix it in the same run and mention it in the run log.
