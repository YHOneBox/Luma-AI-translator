const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SYSTEM_PROMPT = `You are a professional translator and language tutor.
Look at the screenshot and identify any text visible in the image.
Translate the most prominent or selected text into {targetLanguage}.
If the text is already in {targetLanguage}, provide a clear definition and usage explanation instead.

Return structured JSON with:
- translation: the translation or definition in {targetLanguage}
- source_text: the original text exactly as seen in the screenshot or selection (before translation)
- example_sentence: a natural example sentence using the word/phrase in the source language
- example_translation: translation of the example sentence into {targetLanguage}
- context_explanation: general meaning and typical usage, in {targetLanguage}
- usage_in_context: 2–4 sentences in {targetLanguage} explaining how the word/phrase is used in THIS specific screenshot or selected text — reference the actual surrounding context, domain, register, and why this translation fits
- part_of_speech: part of speech abbreviation (e.g. n., v., adj.) when applicable, otherwise empty string
- phonetic_ipa: IPA transcription for single English words (e.g. /ˈælɡəɹɪðəm/), otherwise empty string
- base_word: the primary English dictionary headword (lowercase, single word or short phrase suitable for Cambridge Dictionary lookup)`;

const DEFAULT_SETTINGS = {
  primaryModel: 'gemini-3.5-flash-lite',
  fallbackModels: ['gemini-3.6-flash', 'gemini-3.5-flash'],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  targetLanguage: 'Chinese (Traditional)',
  replaceLanguage: 'English',
  uiLocale: 'en',
  hasChosenUiLocale: false,
  hotkeyScreen: 'Alt+S',
  hotkeyRegion: 'Alt+C',
  hotkeySelection: 'Alt+T',
  hotkeyReplace: 'Alt+R',
  hotkeyGrammar: 'Alt+G',
  hotkeyDictionary: 'Alt+D',
  hotkeyAsk: 'Alt+A',
  launchAtStartup: false,
  apiKeys: [],
  activeApiKeyId: null,
};

/** Previous defaults — upgrade installs that never customized these hotkeys. */
const LEGACY_HOTKEY_VALUES = {
  hotkeyScreen: ['CommandOrControl+Shift+T', 'Alt+T'],
  hotkeyRegion: ['CommandOrControl+Shift+R'],
  hotkeySelection: ['CommandOrControl+Shift+S', 'Alt+X'],
};

const LEGACY_DEFAULT_PRIMARY_MODELS = new Set(['gemini-3.6-flash']);

const DEPRECATED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]);

function migrateSettings(settings) {
  const incoming = settings && typeof settings === 'object' ? settings : {};
  const isExistingInstall = Object.keys(incoming).length > 0;
  const migrated = { ...DEFAULT_SETTINGS, ...incoming };
  let changed = false;

  if (isExistingInstall && incoming.hasChosenUiLocale === undefined) {
    migrated.hasChosenUiLocale = true;
    changed = true;
  }

  if (!migrated.uiLocale) {
    migrated.uiLocale = DEFAULT_SETTINGS.uiLocale;
    changed = true;
  }

  if (DEPRECATED_MODELS.has(migrated.primaryModel)) {
    migrated.primaryModel = DEFAULT_SETTINGS.primaryModel;
    changed = true;
  } else if (LEGACY_DEFAULT_PRIMARY_MODELS.has(migrated.primaryModel)) {
    // Upgrade installs that still use the previous built-in primary default.
    migrated.primaryModel = DEFAULT_SETTINGS.primaryModel;
    migrated.fallbackModels = [...DEFAULT_SETTINGS.fallbackModels];
    changed = true;
  }

  const filteredFallbacks = (migrated.fallbackModels || []).filter(
    (id) => !DEPRECATED_MODELS.has(id) && id !== migrated.primaryModel
  );
  if (filteredFallbacks.length !== (migrated.fallbackModels || []).length) {
    migrated.fallbackModels =
      filteredFallbacks.length > 0
        ? filteredFallbacks
        : [...DEFAULT_SETTINGS.fallbackModels];
    changed = true;
  }

  for (const key of [
    'hotkeyScreen',
    'hotkeyRegion',
    'hotkeySelection',
    'hotkeyReplace',
    'hotkeyGrammar',
    'hotkeyDictionary',
    'hotkeyAsk',
  ]) {
    if (!migrated[key]) {
      migrated[key] = DEFAULT_SETTINGS[key];
      changed = true;
    } else if ((LEGACY_HOTKEY_VALUES[key] || []).includes(migrated[key])) {
      migrated[key] = DEFAULT_SETTINGS[key];
      changed = true;
    }
  }

  if (!migrated.replaceLanguage) {
    migrated.replaceLanguage = DEFAULT_SETTINGS.replaceLanguage;
    changed = true;
  } else if (migrated.replaceLanguage === 'Chinese') {
    migrated.replaceLanguage = DEFAULT_SETTINGS.replaceLanguage;
    changed = true;
  }

  if (migrated.targetLanguage === 'English') {
    migrated.targetLanguage = DEFAULT_SETTINGS.targetLanguage;
    changed = true;
  }

  if (!Array.isArray(migrated.apiKeys)) {
    migrated.apiKeys = [];
    changed = true;
  }

  if (migrated.activeApiKeyId === undefined) {
    migrated.activeApiKeyId = migrated.apiKeys[0]?.id || null;
    changed = true;
  }

  if (typeof migrated.launchAtStartup !== 'boolean') {
    migrated.launchAtStartup = DEFAULT_SETTINGS.launchAtStartup;
    changed = true;
  }

  return { migrated, changed };
}

let settingsCache = null;
let settingsPath = null;

function getSettingsPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }
  return settingsPath;
}

function loadSettings() {
  if (settingsCache) return settingsCache;

  try {
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { migrated, changed } = migrateSettings({
        ...DEFAULT_SETTINGS,
        ...JSON.parse(raw),
      });
      settingsCache = migrated;
      if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(settingsCache, null, 2), 'utf8');
      }
      return settingsCache;
    }
  } catch {
    // fall through to defaults
  }

  settingsCache = { ...DEFAULT_SETTINGS };
  return settingsCache;
}

function saveSettings(updates) {
  const current = loadSettings();
  const { apiKeys: _ignoredKeys, activeApiKeyId: _ignoredActive, ...safeUpdates } = updates;

  settingsCache = {
    ...current,
    ...safeUpdates,
    fallbackModels: Array.isArray(updates.fallbackModels)
      ? updates.fallbackModels
      : current.fallbackModels,
    apiKeys: current.apiKeys,
    activeApiKeyId: current.activeApiKeyId,
  };

  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settingsCache, null, 2), 'utf8');
  return settingsCache;
}

function saveApiKeyState(apiKeyUpdates) {
  const current = loadSettings();
  settingsCache = {
    ...current,
    ...apiKeyUpdates,
  };

  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settingsCache, null, 2), 'utf8');
  return settingsCache;
}

function getDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

function resetSettings() {
  const current = loadSettings();
  settingsCache = {
    ...DEFAULT_SETTINGS,
    apiKeys: current.apiKeys || [],
    activeApiKeyId: current.activeApiKeyId || null,
  };
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settingsCache, null, 2), 'utf8');
  return settingsCache;
}

function getPublicSettings() {
  const settings = loadSettings();
  const { getApiKeysPublic } = require('./api-keys');
  const { apiKeys: _rawKeys, ...rest } = settings;

  return {
    ...rest,
    apiKeys: getApiKeysPublic(settings),
    hasEnvApiKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
  };
}

function resolveSystemPrompt(settings) {
  const language = settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
  return (settings.systemPrompt || DEFAULT_SYSTEM_PROMPT).replace(
    /\{targetLanguage\}/g,
    language
  );
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  saveApiKeyState,
  getDefaultSettings,
  resetSettings,
  resolveSystemPrompt,
  getPublicSettings,
};
