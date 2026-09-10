const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

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
    return Boolean(getWindowsPortablePath());
  }
  if (process.platform === 'linux') {
    return Boolean(process.env.APPIMAGE);
  }
  return false;
}

function getWindowsPortablePath() {
  const envFile = process.env.PORTABLE_EXECUTABLE_FILE;
  if (envFile && fs.existsSync(envFile)) {
    return envFile;
  }

  const dir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!dir || !fs.existsSync(dir)) {
    return null;
  }

  try {
    const names = fs.readdirSync(dir).filter((name) => /luma.*\.exe$/i.test(name));
    const portable = names.filter((name) => /portable\.exe$/i.test(name));
    const pool = portable.length > 0 ? portable : names;
    if (pool.length === 1) {
      return path.join(dir, pool[0]);
    }
    if (pool.length > 1) {
      const currentName = `Luma-${app.getVersion()}-win-Portable.exe`.toLowerCase();
      const current = pool.find((name) => name.toLowerCase() === currentName);
      if (current) return path.join(dir, current);
      const newest = pool
        .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0];
      return path.join(dir, newest.name);
    }
  } catch {
    // fall through
  }

  const appFile = process.env.PORTABLE_EXECUTABLE_APP_FILENAME;
  if (appFile) {
    const candidate = path.join(dir, `${appFile}.exe`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function getInstallTargetPath() {
  if (process.platform === 'win32') {
    return getWindowsPortablePath();
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    return process.env.APPIMAGE;
  }
  return null;
}

function getReplacePath(currentPath, downloadName) {
  const dir = path.dirname(currentPath);
  const name = downloadName ? path.basename(String(downloadName)) : '';
  if (name && /\.(exe|appimage)$/i.test(name) && !name.includes('..') && !path.isAbsolute(name)) {
    return path.join(dir, name);
  }
  return currentPath;
}

function assertUpdateFileLooksValid(filePath) {
  const size = fs.statSync(filePath).size;
  if (size < 5 * 1024 * 1024) {
    throw new Error('Downloaded update file is too small to be a Luma build.');
  }

  const header = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, header, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (process.platform === 'win32' && header.slice(0, 2).toString('ascii') !== 'MZ') {
    throw new Error('Downloaded update was not a Windows executable.');
  }
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
  assertUpdateFileLooksValid(dest);
  onProgress?.({ received, total: total || received, percent: 100 });
  return dest;
}

function writeWindowsApplyScript(replacePath, sourcePath, oldPath) {
  const scriptPath = path.join(app.getPath('temp'), 'luma-apply-update.ps1');
  const body = `$ErrorActionPreference = 'Continue'
$replace = ${JSON.stringify(replacePath)}
$source = ${JSON.stringify(sourcePath)}
$old = ${JSON.stringify(oldPath)}
$waitPid = ${process.pid}
$log = Join-Path $env:TEMP 'luma-update.log'
function Log($m) { "$(Get-Date -Format o) $m" | Out-File -FilePath $log -Append -Encoding utf8 }
Log "waiting for pid $waitPid"
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline -and (Get-Process -Id $waitPid -ErrorAction SilentlyContinue)) {
  Start-Sleep -Milliseconds 400
}
if (Get-Process -Id $waitPid -ErrorAction SilentlyContinue) {
  Log "force-stopping pid $waitPid"
  Stop-Process -Id $waitPid -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800
$copied = $false
for ($i = 1; $i -le 20; $i++) {
  try {
    Copy-Item -LiteralPath $source -Destination $replace -Force -ErrorAction Stop
    $copied = $true
    Log "copied on try $i"
    break
  } catch {
    Log "copy try $i failed: $($_.Exception.Message)"
    Start-Sleep -Milliseconds 500
  }
}
if (-not $copied) {
  Log "copy failed"
  exit 1
}
Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue
if ($old -and ($old.ToLower() -ne $replace.ToLower()) -and (Test-Path -LiteralPath $old)) {
  Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
}
Log "starting $replace"
Start-Process -FilePath $replace
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`;
  fs.writeFileSync(scriptPath, body, 'utf8');
  return scriptPath;
}

function launchWindowsApplyScript(scriptPath) {
  // Electron runs in a Windows Job that kills children on exit.
  // `cmd /c start` breaks the helper out of that job so copy+restart can finish.
  const helperCmd = path.join(app.getPath('temp'), 'luma-apply-update.cmd');
  const cmdBody = `@echo off\r
start "" /min powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}"\r
`;
  fs.writeFileSync(helperCmd, cmdBody, 'utf8');

  const result = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/c', `start "" /min "${helperCmd}"`],
    { windowsHide: true, timeout: 8000, cwd: app.getPath('temp') }
  );
  if (result.error) {
    throw result.error;
  }
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

function applyDownloadedUpdate(downloadedPath, info) {
  if (!app.isPackaged) {
    throw new Error('In-app install only works in the packaged Luma app.');
  }

  const currentPath = getInstallTargetPath();
  if (!currentPath) {
    throw new Error('Could not find the current app file to replace.');
  }

  const replacePath = getReplacePath(currentPath, info?.downloadName);

  if (process.platform === 'win32') {
    const scriptPath = writeWindowsApplyScript(replacePath, downloadedPath, currentPath);
    launchWindowsApplyScript(scriptPath);
    return;
  }

  if (process.platform === 'linux') {
    const scriptPath = writeLinuxApplyScript(replacePath, downloadedPath);
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
  applyDownloadedUpdate(filePath, info);
  if (process.platform === 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
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
