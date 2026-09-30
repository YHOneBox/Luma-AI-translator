const https = require('https');
const http = require('http');

const REQUEST_TIMEOUT_MS = 4000;
const IPA_TIMEOUT_MS = 2500;
const AUDIO_CACHE_LIMIT = 80;

const audioCache = new Map();
const ipaCache = new Map();

function httpGetBuffer(url, redirectCount = 0, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;

    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Luma/1.0.14 (Electron)',
          Accept: '*/*',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectCount < 3
        ) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          res.resume();
          httpGetBuffer(next, redirectCount + 1, timeoutMs).then(resolve).catch(reject);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function cacheGet(map, key) {
  if (!map.has(key)) return undefined;
  const value = map.get(key);
  map.delete(key);
  map.set(key, value);
  return value;
}

function cacheSet(map, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > AUDIO_CACHE_LIMIT) {
    map.delete(map.keys().next().value);
  }
}

function normalizeIpa(ipa) {
  const trimmed = String(ipa || '').trim();
  if (!trimmed) return '';

  const inner = trimmed.replace(/^\/+|\/+$/g, '');
  return inner ? `/${inner}/` : '';
}

const { isSingleEnglishWord } = require('./translate-mode');

function looksLikeAudio(body, contentType) {
  if (!body || body.length < 64) return false;
  if (String(contentType || '').includes('audio')) return true;
  if (body.slice(0, 3).toString('latin1') === 'ID3') return true;
  return body[0] === 0xff && (body[1] & 0xe0) === 0xe0;
}

function extractIpaFromWikitext(wikitext) {
  if (!wikitext) return '';

  const patterns = [
    /\{\{IPA\|en\|(\/[^|}\n]+\/)/i,
    /\{\{IPA\|en\|([^|}\n]+)/i,
    /\{\{en-IPA\|([^|}\n]+)/i,
    /\/[\u0250-\u02AF\u0280-\u02FF\u0361\u0325\u031A\u0303\u02C8\u02CC\u02D0a-zA-Z]+\//,
  ];

  for (const pattern of patterns) {
    const match = wikitext.match(pattern);
    if (match?.[1]) return normalizeIpa(match[1]);
    if (match?.[0] && match[0].startsWith('/')) return normalizeIpa(match[0]);
  }

  return '';
}

async function fetchIpaFromWiktionary(word) {
  const cached = cacheGet(ipaCache, word);
  if (cached !== undefined) return cached;

  const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&origin=*`;
  const { status, body } = await httpGetBuffer(url, 0, IPA_TIMEOUT_MS);
  if (status !== 200) {
    cacheSet(ipaCache, word, '');
    return '';
  }

  const data = JSON.parse(body.toString('utf8'));
  const ipa = extractIpaFromWikitext(data.parse?.wikitext?.['*'] || '');
  cacheSet(ipaCache, word, ipa);
  return ipa;
}

function getGoogleTtsUrl(text, lang, client, host) {
  return `https://${host}/translate_tts?ie=UTF-8&client=${client}&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
}

function youdaoLang(lang) {
  const raw = String(lang || 'en').toLowerCase();
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('ja')) return 'ja';
  if (raw.startsWith('ko')) return 'ko';
  if (raw.startsWith('fr')) return 'fr';
  if (raw.startsWith('de')) return 'de';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('pt')) return 'pt';
  if (raw.startsWith('it')) return 'it';
  if (raw.startsWith('ru')) return 'ru';
  if (raw.startsWith('ar')) return 'ar';
  if (raw.startsWith('hi')) return 'hi';
  if (raw.startsWith('th')) return 'th';
  if (raw.startsWith('vi')) return 'vi';
  return 'en';
}

function getYoudaoTtsUrl(text, lang = 'en') {
  const q = encodeURIComponent(text);
  const le = youdaoLang(lang);
  if (le === 'en') {
    return `https://dict.youdao.com/dictvoice?audio=${q}&type=2`;
  }
  return `https://dict.youdao.com/dictvoice?audio=${q}&le=${encodeURIComponent(le)}`;
}

function ttsCandidateUrls(text, lang = 'en') {
  return [
    getGoogleTtsUrl(text, lang, 'tw-ob', 'translate.google.com'),
    getGoogleTtsUrl(text, lang, 'gtx', 'translate.googleapis.com'),
    getYoudaoTtsUrl(text, lang),
  ];
}

async function fetchAudioDataUrl(sourceUrl) {
  const { status, body, headers } = await httpGetBuffer(sourceUrl);
  if (status !== 200 || !looksLikeAudio(body, headers['content-type'])) return null;

  const mime = String(headers['content-type'] || 'audio/mpeg').split(';')[0] || 'audio/mpeg';
  return `data:${mime};base64,${body.toString('base64')}`;
}

async function fetchTtsDataUrl(text, lang = 'en') {
  const snippet = String(text || '').trim().slice(0, 480);
  if (!snippet) return null;

  const cacheKey = `${lang}:${snippet}`;
  const cached = cacheGet(audioCache, cacheKey);
  if (cached !== undefined) return cached;

  try {
    const dataUrl = await Promise.any(
      ttsCandidateUrls(snippet, lang).map((url) =>
        fetchAudioDataUrl(url).then((value) => {
          if (!value) throw new Error('empty');
          return value;
        })
      )
    );
    cacheSet(audioCache, cacheKey, dataUrl);
    return dataUrl;
  } catch {
    cacheSet(audioCache, cacheKey, null);
    return null;
  }
}

function normalizeTtsLang(code) {
  const raw = String(code || 'en').trim().toLowerCase();
  if (!raw) return 'en';
  if (raw.includes('-')) return raw.split('-')[0];
  return raw;
}

const TTS_LANG_MAP = {
  english: 'en',
  chinese: 'zh-CN',
  'traditional chinese': 'zh-TW',
  'chinese (traditional)': 'zh-TW',
  'simplified chinese': 'zh-CN',
  'chinese (simplified)': 'zh-CN',
  japanese: 'ja',
  korean: 'ko',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  portuguese: 'pt',
  italian: 'it',
  russian: 'ru',
  arabic: 'ar',
  hindi: 'hi',
  thai: 'th',
  vietnamese: 'vi',
};

function getTtsLangCode(languageName) {
  const key = String(languageName || 'english').trim().toLowerCase();
  return TTS_LANG_MAP[key] || 'en';
}

function cleanLookupWord(word) {
  return String(word || '')
    .trim()
    .toLowerCase()
    .replace(/['']s$/i, '')
    .replace(/^[^a-z]+|[^a-z'-]+$/g, '');
}

function resolveLookupWord(result) {
  const candidates = [
    result.base_word,
    result.sourceText,
    result.example_sentence?.match(/\b[a-zA-Z'-]+\b/)?.[0],
  ];

  for (const candidate of candidates) {
    const word = cleanLookupWord(String(candidate || '').split(/\s+/)[0]);
    if (word && isSingleEnglishWord(word)) {
      return word;
    }
  }

  return null;
}

async function enrichWithPronunciation(result, onPartial) {
  const lookupWord = resolveLookupWord(result);

  if (!lookupWord) {
    return { ...result, isSingleWord: false, pronunciationReady: false };
  }

  const base = { ...result, isSingleWord: true, lookupWord, layoutMode: 'word' };
  let phonetic = normalizeIpa(result.phonetic_ipa || result.phonetic || '');
  let audioDataUrl = null;

  const emit = (loading) => {
    onPartial?.({
      ...base,
      phonetic,
      audioDataUrl,
      pronunciationLoading: loading,
      pronunciationReady: Boolean(phonetic || audioDataUrl),
    });
  };

  const audioTask = fetchTtsDataUrl(lookupWord, 'en')
    .then((url) => {
      audioDataUrl = url;
      emit(!phonetic);
    })
    .catch(() => {});

  const ipaTask = phonetic
    ? Promise.resolve()
    : fetchIpaFromWiktionary(lookupWord)
        .then((ipa) => {
          if (ipa) phonetic = ipa;
          emit(!audioDataUrl);
        })
        .catch(() => {});

  await Promise.all([audioTask, ipaTask]);

  return {
    ...base,
    phonetic,
    audioDataUrl,
    pronunciationReady: Boolean(phonetic || audioDataUrl),
    layoutMode: 'word',
  };
}

async function enrichPhraseResult(result, targetLanguage = 'English', onPartial) {
  const { getSourceText } = require('./translate-mode');
  const source = getSourceText(result);
  const translation = String(result.translation || '').trim();
  const targetLang = getTtsLangCode(targetLanguage);
  const sourceLang = normalizeTtsLang(result.source_language || 'en');

  let sourceAudioDataUrl = null;
  let translationAudioDataUrl = null;
  let sourceDone = !source;
  let translationDone = !translation;

  const snapshot = () => ({
    ...result,
    isSingleWord: false,
    layoutMode: 'phrase',
    sourceDisplay: source || translation,
    sourceAudioDataUrl,
    translationAudioDataUrl,
    pronunciationLoading: !(sourceDone && translationDone),
    pronunciationReady: Boolean(sourceAudioDataUrl || translationAudioDataUrl),
  });

  await Promise.all([
    source
      ? fetchTtsDataUrl(source, sourceLang)
          .then((url) => {
            sourceAudioDataUrl = url;
            sourceDone = true;
            onPartial?.(snapshot());
          })
          .catch(() => {
            sourceDone = true;
          })
      : Promise.resolve(),
    translation
      ? fetchTtsDataUrl(translation, targetLang)
          .then((url) => {
            translationAudioDataUrl = url;
            translationDone = true;
            onPartial?.(snapshot());
          })
          .catch(() => {
            translationDone = true;
          })
      : Promise.resolve(),
  ]);

  return snapshot();
}

module.exports = {
  enrichWithPronunciation,
  enrichPhraseResult,
  resolveLookupWord,
  normalizeIpa,
};
