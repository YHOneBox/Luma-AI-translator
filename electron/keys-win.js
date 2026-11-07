const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Persistent PowerShell worker for synthetic keystrokes on Windows.
 *
 * Spawning powershell.exe and loading System.Windows.Forms costs ~1–1.5s on a
 * typical machine, and the selection features paid that on every Ctrl+C and
 * Ctrl+V. The worker is started once (pre-warmed at app launch), keeps
 * WinForms loaded, and executes each command in a few milliseconds.
 */

const COMMAND_TIMEOUT_MS = 3000;
const PREAMBLE = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Windows.Forms',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
].join('; ');

let worker = null;
let ready = null;
let buffer = '';
let seq = 0;
const pending = new Map();

function killWorker() {
  if (worker) {
    try {
      worker.kill();
    } catch {
      // ignore
    }
  }
  worker = null;
  ready = null;
  buffer = '';
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error('keystroke worker exited'));
  }
  pending.clear();
}

function handleStdout(chunk) {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    const match = line.match(/^<<luma:(\d+):(ok|err)(?::(.*))?>>$/);
    if (!match) continue;
    const entry = pending.get(Number(match[1]));
    if (!entry) continue;
    pending.delete(Number(match[1]));
    clearTimeout(entry.timer);
    if (match[2] === 'ok') entry.resolve();
    else entry.reject(new Error(match[3] || 'keystroke failed'));
  }
}

function startWorker() {
  if (ready) return ready;

  ready = new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-Sta', '-Command', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      ready = null;
      reject(err);
      return;
    }

    worker = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', handleStdout);
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', () => {});
    proc.on('exit', () => {
      if (worker === proc) killWorker();
    });
    proc.on('error', () => {
      if (worker === proc) killWorker();
    });

    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      killWorker();
      reject(new Error('keystroke worker did not start'));
    }, 8000);
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(`${PREAMBLE}; Write-Output "<<luma:${id}:ok>>"\n`);
  });

  return ready;
}

/**
 * Scripts must be ASCII: PowerShell decodes piped stdin with the console code
 * page, not UTF-8. Keystroke sequences like "^c" / "^v" always are.
 */
function runOnWorker(script) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error('no worker'));
      return;
    }
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      killWorker();
      reject(new Error('keystroke worker timed out'));
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const wrapped =
      `try { ${script}; Write-Output "<<luma:${id}:ok>>" } ` +
      `catch { Write-Output ("<<luma:${id}:err:" + $_.Exception.Message.Replace("\`n", " ") + ">>") }`;
    worker.stdin.write(`${wrapped}\n`);
  });
}

/** Slow path used only when the worker is unavailable. */
async function runOneShot(script) {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Sta',
    '-Command',
    `${PREAMBLE}; ${script}`,
  ]);
}

/**
 * Send a SendKeys sequence (e.g. "^c") to the foreground window.
 * @param {string} keys
 */
async function sendKeys(keys) {
  const script = `Start-Sleep -Milliseconds 40; [System.Windows.Forms.SendKeys]::SendWait("${keys}")`;
  try {
    await startWorker();
    await runOnWorker(script);
  } catch {
    await runOneShot(script);
  }
}

/** Start the worker ahead of time so the first hotkey is not slow. */
function warmUp() {
  startWorker().catch(() => {});
}

function shutdown() {
  killWorker();
}

module.exports = {
  sendKeys,
  warmUp,
  shutdown,
  /** Exposed for tests only. */
  _internal: { startWorker, runOnWorker, killWorker },
};
