const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  translateScreen: () => ipcRenderer.send('translate:screen'),
  translateRegion: () => ipcRenderer.send('translate:region'),
  translateSelection: () => ipcRenderer.send('translate:selection'),
  translateReplace: () => ipcRenderer.send('translate:replace'),
  translateGrammar: () => ipcRenderer.send('translate:grammar'),
  showDictionary: () => ipcRenderer.send('dictionary:show'),
  showAsk: () => ipcRenderer.send('ask:show'),
  closeAsk: () => ipcRenderer.send('ask:close'),
  getAskHistory: () => ipcRenderer.invoke('ask:getHistory'),
  saveAskHistory: (session) => ipcRenderer.send('ask:saveHistory', session),
  askChat: (messages) => ipcRenderer.invoke('ask:chat', messages),
  onAskFocus: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ask:focus', handler);
    return () => ipcRenderer.removeListener('ask:focus', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openUpdatePage: (url) => ipcRenderer.invoke('updates:open', url),
  onUpdateAvailable: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('updates:available', handler);
    return () => ipcRenderer.removeListener('updates:available', handler);
  },
  onUpdateProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('updates:progress', handler);
    return () => ipcRenderer.removeListener('updates:progress', handler);
  },
  getChangelog: () => ipcRenderer.invoke('changelog:get'),
  onTranslationLoading: (callback) => {
    ipcRenderer.on('translation:loading', (_event, data) => callback(data));
  },
  onTranslationResult: (callback) => {
    ipcRenderer.on('translation:result', (_event, data) => callback(data));
  },
  onTranslationError: (callback) => {
    ipcRenderer.on('translation:error', (_event, data) => callback(data));
  },
  onTranslationPronunciation: (callback) => {
    ipcRenderer.on('translation:pronunciation', (_event, data) => callback(data));
  },
  onDictionaryPronunciation: (callback) => {
    ipcRenderer.on('dictionary:pronunciation', (_event, data) => callback(data));
  },
  closePopup: () => ipcRenderer.send('popup:close'),
  closeDictionary: () => ipcRenderer.send('dictionary:close'),
  dictionaryLookup: (text) => ipcRenderer.invoke('dictionary:lookup', text),
  onDictionaryFocus: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('dictionary:focus', handler);
    return () => ipcRenderer.removeListener('dictionary:focus', handler);
  },
  openDictionary: (url) => ipcRenderer.send('dictionary:open', url),
  regionComplete: (region) => ipcRenderer.send('region:complete', region),
  regionCancel: () => ipcRenderer.send('region:cancel'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getDefaultSettings: () => ipcRenderer.invoke('settings:getDefaults'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  addApiKey: (payload) => ipcRenderer.invoke('apiKeys:add', payload),
  removeApiKey: (id) => ipcRenderer.invoke('apiKeys:remove', id),
  setActiveApiKey: (id) => ipcRenderer.invoke('apiKeys:setActive', id),
  updateApiKeyLabel: (payload) => ipcRenderer.invoke('apiKeys:updateLabel', payload),
  scanModels: () => ipcRenderer.invoke('models:scan'),
  recordHotkey: () => ipcRenderer.invoke('hotkey:record'),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getI18nBundle: () => ipcRenderer.invoke('i18n:getBundle'),
  getSupportedLocales: () => ipcRenderer.invoke('i18n:getLocales'),
  setUiLocale: (payload) => ipcRenderer.invoke('i18n:setLocale', payload),
  onStatusMessage: (callback) => {
    ipcRenderer.on('status:message', (_event, data) => callback(data));
  },
});
