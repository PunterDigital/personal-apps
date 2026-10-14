#!/usr/bin/env node
// Builds the downloads page (_site/) from projects.json and each project's latest GitHub Release.
// Usage: GITHUB_TOKEN=$(gh auth token) node scripts/build-site.mjs [path/to/projects.json]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '_site');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const DEFAULT_ASSETS = {
  windows: '\\.(exe|msi)$',
  macos: '\\.dmg$',
  android: '\\.apk$',
};
const PLATFORM_LABELS = { web: 'Web', windows: 'Windows', macos: 'macOS', android: 'Android' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function latestRelease(repo) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'personal-apps-site' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}: ${await res.text()}`);
  return res.json();
}

function archLabel(name) {
  if (/arm64|aarch64/i.test(name)) return 'Apple Silicon';
  if (/x64|x86_64|amd64|intel/i.test(name)) return 'Intel';
  if (/universal/i.test(name)) return 'Universal';
  return null;
}

function formatSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function downloadsFor(project, release) {
  const links = [];
  for (const platform of project.platforms ?? []) {
    if (platform === 'web') {
      if (project.webUrl) links.push({ platform, label: 'Open web app', href: project.webUrl, primary: true });
      continue;
    }
    if (!release) continue;
    const pattern = new RegExp(project.assets?.[platform] ?? DEFAULT_ASSETS[platform], 'i');
    const matches = release.assets.filter((a) => pattern.test(a.name) && !/blockmap|\.sig$/i.test(a.name));
    for (const asset of matches) {
      const arch = matches.length > 1 ? archLabel(asset.name) : null;
      links.push({
        platform,
        label: `${PLATFORM_LABELS[platform]}${arch ? ` (${arch})` : ''}`,
        href: asset.browser_download_url,
        meta: formatSize(asset.size),
      });
    }
  }
  return links;
}

function renderProject(project, release) {
  const links = downloadsFor(project, release);
  const version = project.private
    ? '<span class="version muted">Web app</span>'
    : release
    ? `<span class="version">${esc(release.tag_name)}</span> · <time datetime="${esc(release.published_at)}">${new Date(release.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</time>`
    : '<span class="version muted">No release yet</span>';
  const buttons = links.length
    ? links
        .map(
          (l) =>
            `<a class="btn${l.primary ? ' primary' : ''}" href="${esc(l.href)}"${l.primary ? ' target="_blank" rel="noopener"' : ''}><span class="plat plat-${l.platform}"></span>${esc(l.label)}${l.meta ? `<small>${esc(l.meta)}</small>` : ''}</a>`,
        )
        .join('')
    : '<p class="muted">Downloads will appear here after the first release.</p>';
  return `
    <article class="app" id="${esc(project.slug)}">
      <header>
        <h2>${esc(project.name)}</h2>
        <p class="meta">${version}</p>
      </header>
      <p class="desc">${esc(project.description)}</p>
      <div class="downloads">${buttons}</div>
      <p class="links">
        ${project.private ? '' : `<a href="https://github.com/${esc(project.repo)}">Source</a>`}
        ${release && !project.private ? `· <a href="${esc(release.html_url)}">Release notes</a>` : ''}
      </p>
    </article>`;
}

const registryPath = process.argv[2] ?? join(root, 'projects.json');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const projects = registry.projects.filter((p) => p.status !== 'hidden');
const sections = [];
for (const project of projects) {
  // A private repo's releases aren't visible to the Pages workflow's token, and
  // its source and release links would 404 for visitors.
  const release = project.private ? null : await latestRelease(project.repo);
  sections.push(renderProject(project, release));
}

// Everything is inlined so the page is a single self-contained index.html.
const template = await readFile(join(root, 'site', 'index.template.html'), 'utf8');
const styles = await readFile(join(root, 'site', 'styles.css'), 'utf8');
const favicon = await readFile(join(root, 'site', 'favicon.svg'), 'utf8');
const html = template
  .replace('{{STYLES}}', () => styles)
  .replace('{{FAVICON}}', () => `data:image/svg+xml,${encodeURIComponent(favicon.trim())}`)
  .replace('{{APPS}}', () => sections.join('\n') ||'<p class="empty">No apps published yet.</p>')
  .replace('{{BUILT_AT}}', new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC');

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.html'), html);
await writeFile(join(outDir, '.nojekyll'), '');
console.log(`Built ${projects.length} app(s) into ${outDir}`);
