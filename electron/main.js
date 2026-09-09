require('dotenv').config();

const path = require('path');

// Optional .env next to the portable .exe (developer / power-user fallback)
require('dotenv').config({ path: path.join(path.dirname(process.execPath), '.env') });

const { app } = require('electron');
const { configureAppPaths, cleanupPortableCache } = require('./app-paths');

configureAppPaths();

// Reduce disk footprint for packaged builds
if (app.isPackaged) {
  app.commandLine.appendSwitch('disable-http-cache');
}

const {
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  Tray,
  Menu,
  screen,
  nativeImage,
} = require('electron');
const { captureScreen } = require('./capture');
const { translateScreenshot, translateText, translateForReplace, correctGrammarForReplace, chatAsk } = require('./gemini');
const { applyLaunchAtStartup, shouldStartHidden } = require('./autostart');
const { checkForUpdates, getChangelog, openReleasePage } = require('./updater');
const { getSelectedText, replaceSelectedText } = require('./selection');
const {
  loadSettings,
  saveSettings,
  saveApiKeyState,
  getDefaultSettings,
  resetSettings,
  getPublicSettings,
} = require('./settings');
const {
  addApiKey,
  removeApiKey,
  setActiveApiKey,
  updateApiKeyLabel,
} = require('./api-keys');
const { scanAvailableModels } = require('./models');
const { validateHotkeys } = require('./hotkey-utils');
const { enrichWithPronunciation, enrichPhraseResult, resolveLookupWord } = require('./pronunciation');
const { resolveLayoutMode } = require('./translate-mode');
const { recordHotkey } = require('./hotkey-recorder');
const {
  getSupportedLocales,
  getBundle,
  setActiveLocale,
  t,
} = require('./i18n');

const isDev = !app.isPackaged;
const ICON_PATH = path.join(__dirname, '../assets/logo.png');

let tray = null;
let mainWindow = null;
let popupWindow = null;
let dictionaryWindow = null;
let askWindow = null;
let regionWindow = null;
let statusWindow = null;
let statusBarCloseTimer = null;
let appIsQuitting = false;
let popupResultSeq = 0;
let dictionaryResultSeq = 0;

function getPageUrl(page) {
  const file = page === 'main' ? 'index' : page;
  if (isDev) {
    return `http://localhost:5173/${file}.html`;
  }
  return `file://${path.join(__dirname, '../dist', `${file}.html`)}`;
}

function createTrayIcon() {
  const image = nativeImage.createFromPath(ICON_PATH);
  if (process.platform === 'win32') {
    return image.resize({ width: 32, height: 32 });
  }
  return image;
}

function rebuildTrayMenu() {
  if (!tray) return;

  tray.setToolTip(t('app.name'));
  const contextMenu = Menu.buildFromTemplate([
    { label: t('tray.open'), click: () => showMainWindow() },
    { type: 'separator' },
    { label: t('tray.translateScreen'), click: () => startTranslation(null) },
    { label: t('tray.translateSelection'), click: () => startSelectionTranslation() },
    { label: t('tray.replaceSelection'), click: () => startReplaceSelectionTranslation() },
    { label: t('tray.fixGrammar'), click: () => startGrammarCorrectionSelection() },
    { label: t('tray.dictionary'), click: () => openDictionaryWindow() },
    { label: t('tray.ask'), click: () => openAskWindow() },
    { label: t('tray.selectRegion'), click: () => openRegionSelector() },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => {
        appIsQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  rebuildTrayMenu();
  tray.on('double-click', () => showMainWindow());
}

function applyUiLocale(localeCode) {
  const next = setActiveLocale(localeCode);
  rebuildTrayMenu();
  return getBundle(next);
}

function showMainWindow() {
  createMainWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    title: 'Luma',
    icon: ICON_PATH,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(getPageUrl('main'));

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed() && !shouldStartHidden()) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (e) => {
    if (!appIsQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createPopupWindow() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.close();
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const popupWidth = 460;
  const popupHeight = 520;

  let x = cursor.x + 16;
  let y = cursor.y + 16;

  if (x + popupWidth > display.bounds.x + display.bounds.width) {
    x = display.bounds.x + display.bounds.width - popupWidth - 16;
  }
  if (y + popupHeight > display.bounds.y + display.bounds.height) {
    y = display.bounds.y + display.bounds.height - popupHeight - 16;
  }

  popupWindow = new BrowserWindow({
    width: popupWidth,
    height: popupHeight,
    minWidth: 340,
    minHeight: 380,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    ...(process.platform === 'win32' ? { thickFrame: true } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popupWindow.loadURL(getPageUrl('popup'));

  popupWindow.once('ready-to-show', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.show();
      popupWindow.focus();
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });

  return popupWindow;
}

function placeNearCursor(width, height) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea || display.bounds;

  // Fit inside the visible work area (avoids title bar going off-screen)
  const maxWidth = Math.max(320, area.width - 24);
  const maxHeight = Math.max(360, area.height - 24);
  const w = Math.min(width, maxWidth);
  const h = Math.min(height, maxHeight);

  let x = cursor.x + 16;
  let y = cursor.y + 16;

  if (x + w > area.x + area.width) {
    x = area.x + area.width - w - 12;
  }
  if (y + h > area.y + area.height) {
    y = area.y + area.height - h - 12;
  }
  if (x < area.x + 8) x = area.x + 8;
  if (y < area.y + 8) y = area.y + 8;

  return { x, y, width: w, height: h };
}

function openDictionaryWindow() {
  const popupWidth = 460;
  const popupHeight = 560;
  const { x, y, width, height } = placeNearCursor(popupWidth, popupHeight);

  if (dictionaryWindow && !dictionaryWindow.isDestroyed()) {
    dictionaryWindow.setBounds({ x, y, width, height });
    dictionaryWindow.show();
    dictionaryWindow.focus();
    dictionaryWindow.webContents.send('dictionary:focus');
    return dictionaryWindow;
  }

  dictionaryWindow = new BrowserWindow({
    width,
    height,
    minWidth: 340,
    minHeight: 380,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    ...(process.platform === 'win32' ? { thickFrame: true } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dictionaryWindow.loadURL(getPageUrl('dictionary'));

  dictionaryWindow.once('ready-to-show', () => {
    if (dictionaryWindow && !dictionaryWindow.isDestroyed()) {
      dictionaryWindow.show();
      dictionaryWindow.focus();
      dictionaryWindow.webContents.send('dictionary:focus');
    }
  });

  dictionaryWindow.on('closed', () => {
    dictionaryWindow = null;
  });

  return dictionaryWindow;
}

function openAskWindow() {
  const popupWidth = 460;
  const popupHeight = 560;
  const { x, y, width, height } = placeNearCursor(popupWidth, popupHeight);

  if (askWindow && !askWindow.isDestroyed()) {
    askWindow.setBounds({ x, y, width, height });
    askWindow.show();
    askWindow.focus();
    askWindow.webContents.send('ask:focus');
    return askWindow;
  }

  // Same frameless popup pattern as Dictionary
  askWindow = new BrowserWindow({
    width,
    height,
    minWidth: 340,
    minHeight: 380,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    ...(process.platform === 'win32' ? { thickFrame: true } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  askWindow.loadURL(getPageUrl('ask'));

  askWindow.once('ready-to-show', () => {
    if (askWindow && !askWindow.isDestroyed()) {
      askWindow.show();
      askWindow.focus();
      askWindow.webContents.send('ask:focus');
    }
  });

  askWindow.on('closed', () => {
    askWindow = null;
  });

  return askWindow;
}

async function runDictionaryLookup(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error(t('dictionary.lookupFailed'));
  }

  const seq = ++dictionaryResultSeq;
  const result = await translateText(trimmed);
  if (seq !== dictionaryResultSeq) {
    return formatImmediateResult(result);
  }

  const immediate = formatImmediateResult(result);
  enrichTranslationResult(result)
    .then((enriched) => {
      if (seq !== dictionaryResultSeq) return;
      sendToDictionary('dictionary:pronunciation', enriched);
    })
    .catch(() => {
      if (seq !== dictionaryResultSeq) return;
      sendToDictionary('dictionary:pronunciation', {
        pronunciationLoading: false,
        pronunciationReady: false,
      });
    });

  return immediate;
}

function openRegionSelector() {
  if (regionWindow && !regionWindow.isDestroyed()) {
    regionWindow.focus();
    return;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.bounds;

  regionWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  regionWindow.loadURL(getPageUrl('region'));

  regionWindow.on('closed', () => {
    regionWindow = null;
  });
}

async function waitForPopupReady() {
  if (!popupWindow || popupWindow.isDestroyed()) return;

  if (popupWindow.webContents.isLoading()) {
    await new Promise((resolve) => {
      popupWindow.webContents.once('did-finish-load', resolve);
    });
  }
}

function closeStatusBar() {
  if (statusBarCloseTimer) {
    clearTimeout(statusBarCloseTimer);
    statusBarCloseTimer = null;
  }
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.close();
  }
  statusWindow = null;
}

/**
 * @param {string} message
 * @param {{ variant?: 'loading' | 'success' | 'error', autoCloseMs?: number }} [options]
 */
async function showStatusBar(message, options = {}) {
  const variant = options.variant || 'loading';
  const autoCloseMs = options.autoCloseMs;

  if (statusBarCloseTimer) {
    clearTimeout(statusBarCloseTimer);
    statusBarCloseTimer = null;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const barWidth = Math.min(520, Math.max(300, display.workAreaSize.width - 48));
  const barHeight = 52;
  const x =
    display.workArea.x + Math.round((display.workArea.width - barWidth) / 2);
  const y = display.workArea.y + display.workArea.height - barHeight - 28;

  if (!statusWindow || statusWindow.isDestroyed()) {
    statusWindow = new BrowserWindow({
      width: barWidth,
      height: barHeight,
      x,
      y,
      title: 'Luma Status',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    statusWindow.setIgnoreMouseEvents(true);
    statusWindow.loadURL(getPageUrl('status'));

    statusWindow.on('closed', () => {
      statusWindow = null;
      if (statusBarCloseTimer) {
        clearTimeout(statusBarCloseTimer);
        statusBarCloseTimer = null;
      }
    });

    if (statusWindow.webContents.isLoading()) {
      await new Promise((resolve) => {
        statusWindow.webContents.once('did-finish-load', resolve);
      });
    }

    if (!statusWindow.isDestroyed()) {
      statusWindow.showInactive();
    }
  } else {
    statusWindow.setBounds({ x, y, width: barWidth, height: barHeight });
    statusWindow.showInactive();
  }

  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send('status:message', { message, variant });
  }

  if (typeof autoCloseMs === 'number' && autoCloseMs > 0) {
    statusBarCloseTimer = setTimeout(() => {
      closeStatusBar();
    }, autoCloseMs);
  }
}

function sendToPopup(channel, data) {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send(channel, data);
  }
}

function sendToDictionary(channel, data) {
  if (dictionaryWindow && !dictionaryWindow.isDestroyed()) {
    dictionaryWindow.webContents.send(channel, data);
  }
}

function formatImmediateResult(result) {
  const layoutMode = resolveLayoutMode(result);
  const lookupWord = resolveLookupWord(result) || result.lookupWord;
  return {
    ...result,
    layoutMode: result.layoutMode || layoutMode,
    isSingleWord: layoutMode === 'word' && Boolean(lookupWord || result.isSingleWord),
    lookupWord: lookupWord || undefined,
    phonetic: result.phonetic || result.phonetic_ipa || '',
    pronunciationLoading: true,
    pronunciationReady: false,
  };
}

async function enrichTranslationResult(result) {
  const layoutMode = resolveLayoutMode(result);
  let enriched;

  if (layoutMode === 'word') {
    enriched = await enrichWithPronunciation(result);
  } else {
    const { targetLanguage } = loadSettings();
    enriched = await enrichPhraseResult(result, targetLanguage);
  }

  return {
    ...enriched,
    layoutMode: enriched.layoutMode || layoutMode,
    isSingleWord: layoutMode === 'word' && Boolean(enriched.isSingleWord),
    lookupWord: enriched.lookupWord || resolveLookupWord(enriched) || undefined,
    pronunciationLoading: false,
    pronunciationReady: true,
  };
}

function enrichInBackground(result, seq, send, expectedSeq) {
  enrichTranslationResult(result)
    .then((enriched) => {
      if (seq !== expectedSeq()) return;
      send('translation:pronunciation', enriched);
    })
    .catch(() => {
      if (seq !== expectedSeq()) return;
      send('translation:pronunciation', {
        pronunciationLoading: false,
        pronunciationReady: false,
      });
    });
}

async function runWithPopup(task) {
  const seq = ++popupResultSeq;
  createPopupWindow();
  await waitForPopupReady();

  const sendProgress = (message) => {
    sendToPopup('translation:loading', { message });
  };

  try {
    const result = await task(sendProgress);
    if (seq !== popupResultSeq) return;

    sendToPopup('translation:result', formatImmediateResult(result));
    enrichInBackground(result, seq, sendToPopup, () => popupResultSeq);
  } catch (err) {
    if (seq !== popupResultSeq) return;
    sendToPopup('translation:error', {
      message: err.message || t('progress.translationFailed'),
    });
  }
}

async function startTranslation(region) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  if (regionWindow && !regionWindow.isDestroyed()) {
    regionWindow.hide();
  }

  await new Promise((resolve) => setTimeout(resolve, 200));

  await runWithPopup(async (sendProgress) => {
    sendProgress(t('progress.capturing'));
    const imageBuffer = await captureScreen(region);
    return translateScreenshot(imageBuffer, sendProgress);
  });
}

async function startSelectionTranslation() {
  let text;

  try {
    text = await getSelectedText();
  } catch (err) {
    createPopupWindow();
    await waitForPopupReady();
    sendToPopup('translation:error', {
      message: err.message || t('progress.couldNotReadSelection'),
    });
    return;
  }

  await runWithPopup(async (sendProgress) => translateText(text, sendProgress));
}

async function startReplaceSelectionTranslation() {
  let text;

  try {
    text = await getSelectedText();
  } catch (err) {
    await showStatusBar(
      err.message || t('statusBar.couldNotReadSelection'),
      { variant: 'error', autoCloseMs: 4500 }
    );
    return;
  }

  try {
    await showStatusBar(t('statusBar.replaceInProgress'), { variant: 'loading' });

    const result = await translateForReplace(text, (message) => {
      showStatusBar(message || t('statusBar.translatingSelection'), { variant: 'loading' });
    });

    if (!result?.translation?.trim()) {
      throw new Error(t('statusBar.translationEmpty'));
    }

    await showStatusBar(t('statusBar.pastingTranslation'), { variant: 'loading' });
    closeStatusBar();
    await replaceSelectedText(result.translation);

    await showStatusBar(t('statusBar.replaceComplete'), {
      variant: 'success',
      autoCloseMs: 2500,
    });
  } catch (err) {
    await showStatusBar(
      err.message || t('statusBar.replaceFailed'),
      { variant: 'error', autoCloseMs: 4500 }
    );
  }
}

async function startGrammarCorrectionSelection() {
  let text;

  try {
    text = await getSelectedText();
  } catch (err) {
    await showStatusBar(
      err.message || t('statusBar.couldNotReadSelection'),
      { variant: 'error', autoCloseMs: 4500 }
    );
    return;
  }

  try {
    await showStatusBar(t('statusBar.grammarInProgress'), { variant: 'loading' });

    const result = await correctGrammarForReplace(text, (message) => {
      showStatusBar(message || t('statusBar.checkingGrammar'), { variant: 'loading' });
    });

    if (!result?.correctedText?.trim()) {
      throw new Error(t('statusBar.grammarEmpty'));
    }

    await showStatusBar(t('statusBar.pastingCorrection'), { variant: 'loading' });
    closeStatusBar();
    await replaceSelectedText(result.correctedText);

    const unchanged =
      result.correctedText.trim() === String(text || '').trim();

    await showStatusBar(
      unchanged ? t('statusBar.noGrammarChanges') : t('statusBar.grammarComplete'),
      {
        variant: 'success',
        autoCloseMs: 2500,
      }
    );
  } catch (err) {
    await showStatusBar(
      err.message || t('statusBar.grammarFailed'),
      { variant: 'error', autoCloseMs: 4500 }
    );
  }
}

function registerHotkeys() {
  globalShortcut.unregisterAll();

  const settings = loadSettings();
  const bindings = [
    { accel: settings.hotkeyScreen, action: () => startTranslation(null) },
    { accel: settings.hotkeyRegion, action: () => openRegionSelector() },
    { accel: settings.hotkeySelection, action: () => startSelectionTranslation() },
    { accel: settings.hotkeyReplace, action: () => startReplaceSelectionTranslation() },
    { accel: settings.hotkeyGrammar, action: () => startGrammarCorrectionSelection() },
    { accel: settings.hotkeyDictionary, action: () => openDictionaryWindow() },
    { accel: settings.hotkeyAsk, action: () => openAskWindow() },
  ];

  const failed = [];

  for (const { accel, action } of bindings) {
    if (!accel) continue;
    const ok = globalShortcut.register(accel, action);
    if (!ok) failed.push(accel);
  }

  if (failed.length > 0) {
    console.warn('Failed to register hotkeys (may be in use):', failed.join(', '));
  }
}

function setupIpc() {
  ipcMain.on('translate:screen', () => startTranslation(null));
  ipcMain.on('translate:region', () => openRegionSelector());
  ipcMain.on('translate:selection', () => startSelectionTranslation());
  ipcMain.on('translate:replace', () => startReplaceSelectionTranslation());
  ipcMain.on('translate:grammar', () => startGrammarCorrectionSelection());
  ipcMain.on('dictionary:show', () => openDictionaryWindow());
  ipcMain.on('ask:show', () => openAskWindow());
  ipcMain.on('ask:close', () => {
    if (askWindow && !askWindow.isDestroyed()) {
      askWindow.close();
    }
  });
  ipcMain.handle('ask:chat', async (_event, messages) => {
    try {
      return await chatAsk(messages);
    } catch (err) {
      throw new Error(err.message || t('ask.failed'));
    }
  });
  ipcMain.handle('updates:check', async () => {
    try {
      return await checkForUpdates();
    } catch (err) {
      return { error: err.message || t('updates.checkFailed') };
    }
  });
  ipcMain.handle('updates:open', (_event, url) => {
    openReleasePage(url);
    return true;
  });
  ipcMain.handle('changelog:get', () => getChangelog());
  ipcMain.on('dictionary:close', () => {
    if (dictionaryWindow && !dictionaryWindow.isDestroyed()) {
      dictionaryWindow.close();
    }
  });
  ipcMain.handle('dictionary:lookup', async (_event, text) => {
    try {
      return await runDictionaryLookup(text);
    } catch (err) {
      throw new Error(err.message || t('dictionary.lookupFailed'));
    }
  });

  ipcMain.on('popup:close', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.close();
    }
  });

  ipcMain.on('dictionary:open', (_event, url) => {
    if (url) shell.openExternal(url);
  });

  ipcMain.on('region:complete', (_event, region) => {
    if (regionWindow && !regionWindow.isDestroyed()) {
      regionWindow.close();
    }
    startTranslation(region);
  });

  ipcMain.on('region:cancel', () => {
    if (regionWindow && !regionWindow.isDestroyed()) {
      regionWindow.close();
    }
  });

  ipcMain.handle('settings:get', () => getPublicSettings());
  ipcMain.handle('settings:getDefaults', () => getDefaultSettings());
  ipcMain.handle('settings:save', (_event, updates) => {
    validateHotkeys({ ...loadSettings(), ...updates });
    const saved = saveSettings(updates);
    if (updates?.uiLocale) {
      applyUiLocale(updates.uiLocale);
    }
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'launchAtStartup')) {
      applyLaunchAtStartup(saved.launchAtStartup);
    }
    registerHotkeys();
    return getPublicSettings();
  });
  ipcMain.handle('settings:reset', () => {
    const reset = resetSettings();
    applyUiLocale(reset.uiLocale);
    applyLaunchAtStartup(reset.launchAtStartup);
    registerHotkeys();
    return getPublicSettings();
  });

  ipcMain.handle('i18n:getBundle', () => getBundle());
  ipcMain.handle('i18n:getLocales', () => getSupportedLocales());
  ipcMain.handle('i18n:setLocale', (_event, payload = {}) => {
    const code = payload.locale || payload;
    const markChosen = payload.markChosen !== false;
    const saved = saveSettings({
      uiLocale: code,
      ...(markChosen ? { hasChosenUiLocale: true } : {}),
    });
    return applyUiLocale(saved.uiLocale);
  });

  ipcMain.handle('apiKeys:add', (_event, payload) => {
    const current = loadSettings();
    const next = addApiKey(current, payload);
    saveApiKeyState(next);
    return getPublicSettings();
  });

  ipcMain.handle('apiKeys:remove', (_event, id) => {
    const current = loadSettings();
    const next = removeApiKey(current, id);
    saveApiKeyState(next);
    return getPublicSettings();
  });

  ipcMain.handle('apiKeys:setActive', (_event, id) => {
    const current = loadSettings();
    const next = setActiveApiKey(current, id);
    saveApiKeyState(next);
    return getPublicSettings();
  });

  ipcMain.handle('apiKeys:updateLabel', (_event, { id, label }) => {
    const current = loadSettings();
    const next = updateApiKeyLabel(current, id, label);
    saveApiKeyState(next);
    return getPublicSettings();
  });
  ipcMain.handle('models:scan', async () => {
    try {
      return await scanAvailableModels();
    } catch (err) {
      throw new Error(err.message || t('settings.status.scanFailed'));
    }
  });

  ipcMain.handle('hotkey:record', (event) =>
    recordHotkey(event.sender, registerHotkeys)
  );

  ipcMain.handle('app:getVersion', () => app.getVersion());
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.luma.app');
  }

  const settings = loadSettings();
  applyUiLocale(settings.uiLocale);
  applyLaunchAtStartup(settings.launchAtStartup);

  createTray();
  createMainWindow();
  registerHotkeys();
  setupIpc();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cleanupPortableCache();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('activate', () => {
  showMainWindow();
});
