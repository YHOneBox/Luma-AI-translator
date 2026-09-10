const https = require('https');
const http = require('http');

const REQUEST_TIMEOUT_MS = 8000;

function httpGetBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;

    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Luma/1.0.12 (Electron)',
          Accept: '*/*',
        },
        timeout: REQUEST_TIMEOUT_MS,
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
          httpGetBuffer(next, redirectCount + 1).then(resolve).catch(reject);
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

function normalizeAudioUrl(url) {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function normalizeIpa(ipa) {
  const trimmed = String(ipa || '').trim();
  if (!trimmed) return '';

  const inner = trimmed.replace(/^\/+|\/+$/g, '');
  return inner ? `/${inner}/` : '';
}

const { isSingleEnglishWord } = require('./translate-mode');

function pickPhoneticAndAudio(phonetics, entryPhonetic) {
  let phonetic = entryPhonetic || '';
  let audioUk = null;
  let audioUs = null;
  let audioAny = null;

  for (const item of phonetics || []) {
    if (item.text && !phonetic) {
      phonetic = item.text;
    }

    const url = normalizeAudioUrl(item.audio);
    if (!url) continue;

    const lower = url.toLowerCase();
    if (lower.includes('-uk') || lower.includes('_gb_') || lower.includes('/uk_')) {
      audioUk = audioUk || url;
    } else if (lower.includes('-us') || lower.includes('_us_') || lower.includes('/us_')) {
      audioUs = audioUs || url;
    } else {
      audioAny = audioAny || url;
    }
  }

  if (!audioUs && audioAny) audioUs = audioAny;
  if (!audioUk && audioAny && audioAny !== audioUs) audioUk = audioAny;

  return {
    phonetic: normalizeIpa(phonetic),
    audioUk,
    audioUs,
  };
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
  const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&origin=*`;
  const { status, body } = await httpGetBuffer(url);
  if (status !== 200) return '';

  const data = JSON.parse(body.toString('utf8'));
  return extractIpaFromWikitext(data.parse?.wikitext?.['*'] || '');
}

async function fetchFromDictionaryApi(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const { status, body } = await httpGetBuffer(url);
  if (status !== 200) return null;

  const text = body.toString('utf8').trim();
  if (!text.startsWith('[') && !text.startsWith('{')) return null;

  const entries = JSON.parse(text);
  const entry = entries[0];
  if (!entry) return null;

  return pickPhoneticAndAudio(entry.phonetics, entry.phonetic);
}

function getGoogleTtsUrl(text, lang = 'en') {
  return `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
}

async function fetchAudioDataUrl(sourceUrl) {
  const { status, body, headers } = await httpGetBuffer(sourceUrl);
  if (status !== 200 || body.length === 0) return null;

  const mime = String(headers['content-type'] || 'audio/mpeg').split(';')[0];
  return `data:${mime};base64,${body.toString('base64')}`;
}

async function fetchGoogleTtsDataUrl(text, lang = 'en') {
  const snippet = String(text || '').trim().slice(0, 480);
  if (!snippet) return null;
  return fetchAudioDataUrl(getGoogleTtsUrl(snippet, lang));
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

async function enrichWithPronunciation(result) {
  const lookupWord = resolveLookupWord(result);

  if (!lookupWord) {
    return { ...result, isSingleWord: false, pronunciationReady: false };
  }

  const base = { ...result, isSingleWord: true, lookupWord };

  let phonetic = normalizeIpa(result.phonetic_ipa || result.phonetic || '');
  let audioUk = null;
  let audioUs = null;
  let audioDataUrl = null;

  const tasks = [];

  if (!phonetic) {
    tasks.push(
      fetchIpaFromWiktionary(lookupWord)
        .then((ipa) => {
          if (ipa) phonetic = ipa;
        })
        .catch(() => {})
    );
  }

  tasks.push(
    fetchFromDictionaryApi(lookupWord)
      .then((dict) => {
        if (!dict) return;
        if (!phonetic && dict.phonetic) phonetic = dict.phonetic;
        audioUk = dict.audioUk;
        audioUs = dict.audioUs;
      })
      .catch(() => {})
  );

  tasks.push(
    fetchGoogleTtsDataUrl(lookupWord)
      .then((dataUrl) => {
        if (dataUrl) audioDataUrl = dataUrl;
      })
      .catch(() => {})
  );

  await Promise.all(tasks);

  if (!audioDataUrl && (audioUs || audioUk)) {
    audioDataUrl = await fetchAudioDataUrl(audioUs || audioUk).catch(() => null);
  }

  return {
    ...base,
    phonetic,
    audioUk,
    audioUs,
    audioDataUrl,
    pronunciationReady: Boolean(phonetic || audioDataUrl),
    layoutMode: 'word',
  };
}

async function enrichPhraseResult(result, targetLanguage = 'English') {
  const { getSourceText } = require('./translate-mode');
  const source = getSourceText(result);
  const translation = String(result.translation || '').trim();
  const targetLang = getTtsLangCode(targetLanguage);
  const sourceLang = normalizeTtsLang(result.source_language || 'en');

  const [sourceAudioDataUrl, translationAudioDataUrl] = await Promise.all([
    source ? fetchGoogleTtsDataUrl(source, sourceLang) : null,
    translation ? fetchGoogleTtsDataUrl(translation, targetLang) : null,
  ]);

  return {
    ...result,
    isSingleWord: false,
    layoutMode: 'phrase',
    sourceDisplay: source || translation,
    sourceAudioDataUrl,
    translationAudioDataUrl,
  };
}

module.exports = {
  enrichWithPronunciation,
  enrichPhraseResult,
  resolveLookupWord,
  normalizeIpa,
};
