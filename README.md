# Personal Apps

Control repo for the PunterDigital personal apps, maintained by Claude.

- **Downloads:** https://punterdigital.github.io/personal-apps/
- **Registry:** [`projects.json`](projects.json) lists each app, its repo and its platforms.
- **Process:** [`CLAUDE.md`](CLAUDE.md) is the operations playbook (triage, build, test, release).

## Downloads page

The page is generated from `projects.json` and each app's latest GitHub Release, then deployed to
GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push, daily, and
on demand (`gh workflow run pages.yml`).

Build locally:

```bash
GITHUB_TOKEN=$(gh auth token) node scripts/build-site.mjs
```

## Registry entry

```json
{
  "name": "Nexus SSH",
  "slug": "nexus-ssh",
  "folder": "nexus-ssh",
  "repo": "PunterDigital/nexus-ssh",
  "tag": "nexus ssh",
  "description": "A fast, modern SSH client.",
  "platforms": ["windows", "macos"],
  "webUrl": null,
  "assets": { "windows": "setup.*\\.exe$" }
}
```

`assets` is optional: per-platform regexes for picking release files (defaults: `.exe`/`.msi` for
Windows, `.dmg` for macOS). Set `"status": "hidden"` to leave an app off the page.

## Licence

MIT
