const { clipboard, BrowserWindow } = require('electron');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { sendKeys } = require('./keys-win');

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveClipboard() {
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    hasImage: !clipboard.readImage().isEmpty(),
    image: clipboard.readImage(),
  };
}

function restoreClipboard(saved) {
  if (saved.hasImage && !saved.image.isEmpty()) {
    clipboard.writeImage(saved.image);
  } else if (saved.html) {
    clipboard.write({ text: saved.text, html: saved.html });
  } else {
    clipboard.writeText(saved.text);
  }
}

async function simulateCopyWindows() {
  await sendKeys('^c');
}

async function simulateCopyMac() {
  await execFileAsync('osascript', [
    '-e',
    'tell application "System Events" to keystroke "c" using command down',
  ]);
}

async function simulateCopyLinux() {
  await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+c']);
}

async function simulateCopy() {
  if (process.platform === 'win32') {
    await simulateCopyWindows();
  } else if (process.platform === 'darwin') {
    await simulateCopyMac();
  } else {
    await simulateCopyLinux();
  }
}

async function simulatePasteWindows() {
  await sendKeys('^v');
}

async function simulatePasteMac() {
  await execFileAsync('osascript', [
    '-e',
    'tell application "System Events" to keystroke "v" using command down',
  ]);
}

async function simulatePasteLinux() {
  await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
}

async function simulatePaste() {
  if (process.platform === 'win32') {
    await simulatePasteWindows();
  } else if (process.platform === 'darwin') {
    await simulatePasteMac();
  } else {
    await simulatePasteLinux();
  }
}

/**
 * Simulated Ctrl+C goes to whichever window has keyboard focus. Only a focused
 * Luma window can steal it, so hide just that one instead of every window
 * (which also made the main window disappear on every selection hotkey).
 * @returns {Promise<() => void>} restore function
 */
async function yieldFocusToSourceApp() {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused || focused.isDestroyed() || focused.getTitle() === 'Luma Status') {
    return () => {};
  }

  focused.hide();
  await sleep(250);

  return () => {
    if (!focused.isDestroyed() && !focused.isVisible()) {
      focused.showInactive();
    }
  };
}

const COPY_POLL_INTERVAL_MS = 40;
const COPY_POLL_WINDOW_MS = [450, 650, 800];

async function waitForClipboardText(maxWaitMs) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const text = clipboard.readText().trim();
    if (text) return text;
    await sleep(COPY_POLL_INTERVAL_MS);
  }
  return clipboard.readText().trim();
}

/**
 * Copy the current text selection from the foreground application.
 * Must be called BEFORE opening any app window so focus stays on the source app.
 * @returns {Promise<string>}
 */
async function getSelectedText() {
  const restoreFocus = await yieldFocusToSourceApp();

  const saved = saveClipboard();

  try {
    for (let attempt = 0; attempt < COPY_POLL_WINDOW_MS.length; attempt++) {
      // Start from an empty clipboard so we can tell a fresh copy from stale
      // content — including the case where the user selects the same text twice.
      clipboard.clear();
      await simulateCopy();

      const text = await waitForClipboardText(COPY_POLL_WINDOW_MS[attempt]);
      if (text) {
        return text;
      }
    }

    throw new Error(
      'Could not copy selected text. Highlight a word in another app first, then use the hotkey (do not click this app before pressing it).'
    );
  } finally {
    restoreClipboard(saved);
    restoreFocus();
  }
}

/**
 * Paste text into the focused app (replaces the current selection when still selected).
 * Keeps Luma windows hidden so focus stays on the source app.
 * @param {string} text
 */
async function replaceSelectedText(text) {
  const value = String(text || '');
  if (!value) {
    throw new Error('Nothing to paste.');
  }

  const restoreFocus = await yieldFocusToSourceApp();

  const saved = saveClipboard();

  try {
    clipboard.writeText(value);
    await sleep(80);
    await simulatePaste();
    await sleep(200);
  } finally {
    restoreClipboard(saved);
    restoreFocus();
  }
}

module.exports = { getSelectedText, replaceSelectedText };
