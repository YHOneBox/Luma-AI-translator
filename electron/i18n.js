const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../locales');

const SUPPORTED_LOCALES = [
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'zh-CN', nativeName: '简体中文', englishName: 'Chinese (Simplified)', dir: 'ltr' },
  { code: 'zh-TW', nativeName: '繁體中文', englishName: 'Chinese (Traditional)', dir: 'ltr' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', dir: 'ltr' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', dir: 'ltr' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', dir: 'ltr' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', dir: 'rtl' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', dir: 'ltr' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', dir: 'ltr' },
];

const bundleCache = new Map();
let activeLocale = 'en';

function loadBundle(code) {
  if (bundleCache.has(code)) return bundleCache.get(code);

  const filePath = path.join(LOCALES_DIR, `${code}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const bundle = JSON.parse(raw);
    bundleCache.set(code, bundle);
    return bundle;
  } catch {
    if (code !== 'en') return loadBundle('en');
    return {};
  }
}

function getSupportedLocales() {
  return SUPPORTED_LOCALES.map((item) => ({ ...item }));
}

function isSupportedLocale(code) {
  return SUPPORTED_LOCALES.some((item) => item.code === code);
}

function normalizeLocale(code) {
  if (isSupportedLocale(code)) return code;
  return 'en';
}

function setActiveLocale(code) {
  activeLocale = normalizeLocale(code);
  return activeLocale;
}

function getActiveLocale() {
  return activeLocale;
}

function getLocaleMeta(code = activeLocale) {
  return (
    SUPPORTED_LOCALES.find((item) => item.code === code) ||
    SUPPORTED_LOCALES[0]
  );
}

function getByPath(obj, keyPath) {
  return keyPath.split('.').reduce((acc, part) => {
    if (acc && typeof acc === 'object' && part in acc) return acc[part];
    return undefined;
  }, obj);
}

function formatMessage(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, name) => {
    if (vars[name] === undefined || vars[name] === null) return `{${name}}`;
    return String(vars[name]);
  });
}

function t(key, vars = {}, locale = activeLocale) {
  const bundle = loadBundle(normalizeLocale(locale));
  const fallback = loadBundle('en');
  const value = getByPath(bundle, key) ?? getByPath(fallback, key) ?? key;
  if (typeof value !== 'string') return key;
  return formatMessage(value, vars);
}

function deepFill(base, override) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return override !== undefined ? override : base;
  }
  const result = { ...base };
  if (!override || typeof override !== 'object') return result;
  for (const key of Object.keys(override)) {
    const ov = override[key];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && typeof result[key] === 'object') {
      result[key] = deepFill(result[key], ov);
    } else if (ov !== undefined) {
      result[key] = ov;
    }
  }
  return result;
}

function getBundle(locale = activeLocale) {
  const code = normalizeLocale(locale);
  const en = loadBundle('en');
  const localized = code === 'en' ? en : deepFill(en, loadBundle(code));
  return {
    locale: code,
    meta: getLocaleMeta(code),
    messages: localized,
  };
}

module.exports = {
  SUPPORTED_LOCALES,
  getSupportedLocales,
  isSupportedLocale,
  normalizeLocale,
  setActiveLocale,
  getActiveLocale,
  getLocaleMeta,
  getBundle,
  t,
};
