const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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

function isDirectAssetUrl(url) {
  return Boolean(url) && /github\.com\/.+\/releases\/download\//i.test(url);
}

function canInstallInApp(asset) {
  if (!app.isPackaged || !isDirectAssetUrl(asset?.url)) return false;
  if (process.platform === 'win32') {
    return Boolean(
      process.env.PORTABLE_EXECUTABLE_FILE ||
        process.env.PORTABLE_EXECUTABLE_DIR ||
        (process.execPath && process.execPath.toLowerCase().endsWith('.exe'))
    );
  }
  if (process.platform === 'linux') {
    return Boolean(process.env.APPIMAGE);
  }
  return false;
}

function getInstallTargetPath() {
  if (process.platform === 'win32') {
    return (
      process.env.PORTABLE_EXECUTABLE_FILE ||
      (process.env.PORTABLE_EXECUTABLE_DIR
        ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, path.basename(process.execPath))
        : process.execPath)
    );
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    return process.env.APPIMAGE;
  }
  return process.execPath;
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
    inAppInstallSupported: canInstallInApp(asset),
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

async function downloadUpdateFile(info, onProgress) {
  if (!isDirectAssetUrl(info?.downloadUrl)) {
    throw new Error('No update file is available to install inside the app.');
  }

  const fileName = info.downloadName || `Luma-${info.latestVersion}-update`;
  const dest = path.join(app.getPath('temp'), fileName);
  const currentVersion = info.currentVersion || app.getVersion();

  const response = await fetch(info.downloadUrl, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `Luma/${currentVersion}`,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Could not download update (HTTP ${response.status}).`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
    onProgress?.({
      received,
      total,
      percent: total ? Math.min(99, Math.round((received / total) * 100)) : 0,
    });
  }

  fs.writeFileSync(dest, Buffer.concat(chunks));
  onProgress?.({ received, total: total || received, percent: 100 });
  return dest;
}

function writeWindowsApplyScript(targetPath, sourcePath) {
  const scriptPath = path.join(app.getPath('temp'), 'luma-apply-update.cmd');
  const body = `@echo off
setlocal
set "TARGET=${targetPath.replace(/"/g, '')}"
set "SOURCE=${sourcePath.replace(/"/g, '')}"
set "WAITPID=${process.pid}"
:wait
tasklist /FI "PID eq %WAITPID%" 2>nul | findstr /I /C:"%WAITPID%" >nul
if not errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)
copy /Y "%SOURCE%" "%TARGET%" >nul
if exist "%TARGET%" start "" "%TARGET%"
del "%SOURCE%" >nul 2>&1
del "%~f0" >nul 2>&1
`;
  fs.writeFileSync(scriptPath, body, 'utf8');
  return scriptPath;
}

function writeLinuxApplyScript(targetPath, sourcePath) {
  const scriptPath = path.join(app.getPath('temp'), 'luma-apply-update.sh');
  const body = `#!/bin/bash
TARGET=${JSON.stringify(targetPath)}
SOURCE=${JSON.stringify(sourcePath)}
WAITPID=${process.pid}
while kill -0 "$WAITPID" 2>/dev/null; do sleep 1; done
chmod +x "$SOURCE"
mv -f "$SOURCE" "$TARGET"
nohup "$TARGET" >/dev/null 2>&1 &
rm -f "$0"
`;
  fs.writeFileSync(scriptPath, body, 'utf8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function applyDownloadedUpdate(downloadedPath) {
  if (!app.isPackaged) {
    throw new Error('In-app install only works in the packaged Luma app.');
  }

  const targetPath = getInstallTargetPath();
  if (!targetPath) {
    throw new Error('Could not find the current app file to replace.');
  }

  if (process.platform === 'win32') {
    const scriptPath = writeWindowsApplyScript(targetPath, downloadedPath);
    spawn('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }

  if (process.platform === 'linux') {
    const scriptPath = writeLinuxApplyScript(targetPath, downloadedPath);
    spawn('bash', [scriptPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  throw new Error('In-app install is not supported on this platform yet.');
}

async function downloadAndInstallUpdate(info, onProgress) {
  const filePath = await downloadUpdateFile(info, onProgress);
  applyDownloadedUpdate(filePath);
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
  downloadAndInstallUpdate,
  getChangelog,
  openReleasePage,
  isNewerVersion,
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASES_PAGE,
};
