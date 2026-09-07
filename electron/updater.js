const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const GITHUB_OWNER = 'YHOneBox';
const GITHUB_REPO = 'Luma-ai-translator';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_LIST_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

function parseVersionParts(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function isNewerVersion(remoteVersion, localVersion) {
  const remote = parseVersionParts(remoteVersion);
  const local = parseVersionParts(localVersion);
  const len = Math.max(remote.length, local.length);

  for (let i = 0; i < len; i++) {
    const a = remote[i] || 0;
    const b = local[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function pickDownloadAsset(assets = []) {
  const list = Array.isArray(assets) ? assets : [];
  const names = list.map((a) => ({
    name: a.name || '',
    url: a.browser_download_url || '',
  }));

  const prefer = (test) => names.find((a) => a.url && test(a.name.toLowerCase()));

  if (process.platform === 'win32') {
    return (
      prefer((n) => n.includes('portable') && n.endsWith('.exe')) ||
      prefer((n) => n.endsWith('.exe')) ||
      null
    );
  }

  if (process.platform === 'darwin') {
    return (
      prefer((n) => n.endsWith('.dmg')) ||
      prefer((n) => n.includes('mac') && n.endsWith('.zip')) ||
      prefer((n) => n.endsWith('.zip')) ||
      null
    );
  }

  return (
    prefer((n) => n.endsWith('.appimage')) ||
    prefer((n) => n.includes('linux') && n.endsWith('.zip')) ||
    prefer((n) => n.endsWith('.zip')) ||
    null
  );
}

function githubHeaders(currentVersion) {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': `Luma/${currentVersion}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function fetchJson(url, currentVersion) {
  const response = await fetch(url, { headers: githubHeaders(currentVersion) });
  return { response, json: response.ok ? await response.json() : null };
}

function formatRelease(release, currentVersion) {
  const latestVersion = String(release.tag_name || release.name || '')
    .trim()
    .replace(/^v/i, '');

  if (!latestVersion) {
    throw new Error('Latest release version was missing.');
  }

  const asset = pickDownloadAsset(release.assets);
  const updateAvailable = isNewerVersion(latestVersion, currentVersion);

  return {
    updateAvailable,
    currentVersion,
    latestVersion,
    releaseName: release.name || `v${latestVersion}`,
    releaseNotes: String(release.body || '').trim(),
    publishedAt: release.published_at || null,
    htmlUrl: release.html_url || RELEASES_PAGE,
    downloadUrl: asset?.url || release.html_url || RELEASES_PAGE,
    downloadName: asset?.name || null,
  };
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();

  const latest = await fetchJson(RELEASES_API, currentVersion);

  if (latest.response.ok && latest.json) {
    return formatRelease(latest.json, currentVersion);
  }

  // /releases/latest 404s when the repo is missing OR there is no stable latest tag.
  if (latest.response.status === 404) {
    const list = await fetchJson(`${RELEASES_LIST_API}?per_page=10`, currentVersion);
    if (list.response.ok && Array.isArray(list.json)) {
      const published = list.json.find((item) => !item.draft && !item.prerelease) || list.json[0];
      if (published) {
        return formatRelease(published, currentVersion);
      }
      throw new Error('No GitHub releases found yet.');
    }
  }

  if (latest.response.status === 404) {
    throw new Error('Could not find GitHub releases for this app.');
  }

  throw new Error(`Could not check for updates (HTTP ${latest.response.status}).`);
}

function getChangelog() {
  const candidates = [
    path.join(__dirname, '..', 'changelog.json'),
    path.join(process.resourcesPath || '', 'changelog.json'),
  ];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        return {
          entries: Array.isArray(raw.entries) ? raw.entries : [],
        };
      }
    } catch {
      // try next
    }
  }

  return { entries: [] };
}

function openReleasePage(url) {
  const target = url || RELEASES_PAGE;
  return shell.openExternal(target);
}

module.exports = {
  checkForUpdates,
  getChangelog,
  openReleasePage,
  isNewerVersion,
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASES_PAGE,
};
