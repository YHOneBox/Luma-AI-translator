const { GoogleGenAI, Type } = require('@google/genai');
const { loadSettings, resolveSystemPrompt } = require('./settings');
const { resolveApiKey } = require('./api-keys');
const { detectInputMode, isTwoWordPhrase } = require('./translate-mode');

const WORD_TIMEOUT_MS = 15000;
const PAIR_TIMEOUT_MS = 20000;
const PHRASE_TIMEOUT_MS = 30000;

/** Retries of the SAME model on transient failures (429 / 5xx / bad JSON). */
const MAX_TRANSIENT_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 900;

/** Hedging: fire the next model in parallel once the current one is this slow. */
const HEDGE_DELAY_MS = 2500;
const SCREENSHOT_HEDGE_DELAY_MS = 4000;
/** Long outputs legitimately take longer; hedge later so quota is not doubled. */
const PAIR_HEDGE_DELAY_MS = 4500;
const CHAT_HEDGE_DELAY_MS = 12000;
const MAX_CONCURRENT_LANES = 2;

const clientCache = new Map();

function getClient(apiKey) {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clientCache.set(apiKey, client);
  }
  return client;
}

const WORD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    translation: {
      type: Type.STRING,
      description: 'The translated text or definition in the target language.',
    },
    source_text: {
      type: Type.STRING,
      description: 'The original single word exactly as captured.',
    },
    example_sentence: {
      type: Type.STRING,
      description: 'A natural example sentence using the word in context (source language).',
    },
    example_translation: {
      type: Type.STRING,
      description: 'Translation of the example sentence into the target language.',
    },
    context_explanation: {
      type: Type.STRING,
      description: 'General meaning and typical usage in the target language (1–2 sentences).',
    },
    usage_in_context: {
      type: Type.STRING,
      description:
        '2–4 sentences in the target language explaining how this word is used in the specific context.',
    },
    part_of_speech: {
      type: Type.STRING,
      description: 'Part of speech abbreviation, e.g. n., v., adj.',
    },
    phonetic_ipa: {
      type: Type.STRING,
      description: 'IPA for English headwords, e.g. /ˈælɡəɹɪðəm/. Empty if not English.',
    },
    base_word: {
      type: Type.STRING,
      description: 'English dictionary headword (lowercase).',
    },
  },
  required: [
    'translation',
    'source_text',
    'example_sentence',
    'example_translation',
    'context_explanation',
    'usage_in_context',
    'base_word',
    'part_of_speech',
    'phonetic_ipa',
  ],
};

const PAIR_WORD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    word: {
      type: Type.STRING,
      description: 'One of the two source words, in original order.',
    },
    part_of_speech: {
      type: Type.STRING,
      description: 'Part of speech of this word in the pair, e.g. n., v., adj., prep.',
    },
    meaning: {
      type: Type.STRING,
      description:
        'A detailed description of this word in the target language: core sense, nuance, typical uses, and the exact role it plays in this two-word phrase.',
    },
  },
  required: ['word', 'part_of_speech', 'meaning'],
};

const PAIR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    source_text: {
      type: Type.STRING,
      description: 'The original two words, unchanged.',
    },
    translation: {
      type: Type.STRING,
      description:
        'The natural equivalent of the two-word phrase in THIS context, in the target language. Not a word-by-word gloss.',
    },
    why_here: {
      type: Type.STRING,
      description:
        '2–4 sentences in the target language explaining why this sense and this translation fit here.',
    },
    words: {
      type: Type.ARRAY,
      description: 'Exactly two entries, one per source word, in order.',
      items: PAIR_WORD_SCHEMA,
    },
    source_language: {
      type: Type.STRING,
      description: 'BCP-47 code of the source, usually en.',
    },
  },
  required: ['source_text', 'translation', 'why_here', 'words', 'source_language'],
};

const PHRASE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    source_text: {
      type: Type.STRING,
      description:
        'The complete original text exactly as provided or visible in the image. Preserve paragraph breaks.',
    },
    translation: {
      type: Type.STRING,
      description:
        'The complete translation into the target language. Translate every sentence; preserve paragraph breaks and list structure. Do not summarize.',
    },
    source_language: {
      type: Type.STRING,
      description:
        'BCP-47 language code of the source text, e.g. en, zh, ja. Best guess from the content.',
    },
  },
  required: ['source_text', 'translation', 'source_language'],
};

/**
 * For typed/selected text we already hold the source, so do not make the model
 * echo it back — that roughly halves the output tokens on long passages.
 */
const TEXT_PHRASE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    translation: PHRASE_SCHEMA.properties.translation,
    source_language: PHRASE_SCHEMA.properties.source_language,
  },
  required: ['translation', 'source_language'],
};

const SCREENSHOT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mode: {
      type: Type.STRING,
      description:
        'word = exactly one dictionary word. pair = exactly two words (collocation, phrasal verb, or compound). phrase = a sentence, clause, or three or more words.',
    },
    source_text: {
      type: Type.STRING,
      description: 'All primary text visible in the image that should be translated.',
    },
    translation: {
      type: Type.STRING,
      description:
        'phrase: complete translation of ALL source_text. word: the word translation. pair: the contextual equivalent of the two-word phrase, not a word-by-word gloss.',
    },
    source_language: {
      type: Type.STRING,
      description: 'BCP-47 code of source_text, e.g. en, zh.',
    },
    example_sentence: { type: Type.STRING, description: 'Word mode only; empty string for phrase mode.' },
    example_translation: { type: Type.STRING, description: 'Word mode only; empty string for phrase mode.' },
    context_explanation: { type: Type.STRING, description: 'Word mode only; empty string for phrase mode.' },
    usage_in_context: { type: Type.STRING, description: 'Word mode only; empty string for phrase mode.' },
    part_of_speech: { type: Type.STRING, description: 'Word mode only; empty string for phrase mode.' },
    phonetic_ipa: { type: Type.STRING, description: 'Word mode only; empty string for phrase mode.' },
    base_word: { type: Type.STRING, description: 'Word mode only; empty string otherwise.' },
    why_here: {
      type: Type.STRING,
      description: 'Pair mode: why this translation fits this context. Empty string otherwise.',
    },
    words: {
      type: Type.ARRAY,
      description: 'Pair mode: exactly two detailed word entries. Empty array otherwise.',
      items: PAIR_WORD_SCHEMA,
    },
  },
  required: [
    'mode',
    'source_text',
    'translation',
    'source_language',
    'example_sentence',
    'example_translation',
    'context_explanation',
    'usage_in_context',
    'part_of_speech',
    'phonetic_ipa',
    'base_word',
    'why_here',
    'words',
  ],
};

function resolvePhraseSystemPrompt(settings) {
  const language = settings.targetLanguage || 'Chinese (Traditional)';
  return `You are an expert professional translator.

Translate the ENTIRE source text into ${language}.

Rules:
- Translate ALL content completely. Never translate only keywords or give a summary.
- Preserve meaning, tone, register, names, numbers, and formatting intent.
- Preserve paragraph breaks, line breaks, and bullet/list structure from the source.
- Do not add explanations, notes, or extra commentary outside the translation.
- translation must contain ONLY the translated text in ${language}.`;
}

function resolveScreenshotSystemPrompt(settings) {
  const language = settings.targetLanguage || 'Chinese (Traditional)';
  return `You analyze screenshots and extract text for translation into ${language}.

Step 1 — Extract the primary text block the user most likely wants translated (ignore UI chrome, watermarks, and unrelated background text when possible).

Step 2 — Decide mode:
- mode=word ONLY if the primary text is exactly ONE dictionary word (no spaces, not a sentence).
- mode=pair if the primary text is EXACTLY TWO words (a collocation, phrasal verb, compound, or short phrase such as "machine learning" or "take off").
- mode=phrase for ANY sentence, clause, paragraph, or three or more words.

Step 3 — Respond:
- phrase mode: translation must be a COMPLETE faithful translation of ALL of source_text. Leave example_sentence, example_translation, context_explanation, usage_in_context, part_of_speech, phonetic_ipa, base_word, and why_here as empty strings. words must be an empty array.
- pair mode: use the surrounding screenshot to choose the sense. translation is the natural ${language} equivalent of the two-word unit IN THIS CONTEXT, not a generic word-by-word gloss. why_here explains in ${language} why that sense fits here. words has exactly two entries, in order; each meaning is a detailed ${language} description of that word (core sense, nuance, typical uses, and its role in the pair). Leave the single-word tutor fields empty.
- word mode: fill all dictionary/tutor fields. translation is the ${language} equivalent or definition. why_here is empty and words is an empty array.

Never summarize. Never translate only part of the text when mode=phrase.`;
}

function resolvePairSystemPrompt(settings) {
  const language = settings.targetLanguage || 'Chinese (Traditional)';
  return `You explain two-word English phrases for a learner whose target language is ${language}.

The input is exactly two words: a collocation, phrasal verb, compound, or short phrase.

Rules:
- translation: the natural ${language} equivalent of the TWO-WORD UNIT as used here. Do not only list separate dictionary glosses. If extra surrounding context is visible, use that sense. If the input is only the two words, use their most common combined meaning.
- why_here: 2–4 sentences in ${language} explaining why it means this here — which sense was chosen, how the two words interact, and what would be wrong about a more literal reading.
- words: exactly two objects, in source order. For each word, meaning must be a detailed paragraph in ${language} covering the core meaning, nuance, common uses, and the specific role this word plays in the pair.
- Do not leave meaning or why_here as a short gloss.
- source_text must be the original two words.`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a Gemini request with a hard deadline. The AbortController cancels the
 * underlying HTTP request so a slow call does not keep burning quota after we
 * have already moved on to the next model.
 */
async function requestWithDeadline(ai, params, timeoutMs, cancelSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCancel = () => controller.abort();
  cancelSignal?.addEventListener('abort', onCancel, { once: true });

  try {
    return await ai.models.generateContent({
      ...params,
      config: { ...params.config, abortSignal: controller.signal },
    });
  } catch (err) {
    if (timedOut) {
      const timeoutErr = new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
      timeoutErr.code = 'TIMEOUT';
      throw timeoutErr;
    }
    if (cancelSignal?.aborted) {
      const cancelErr = new Error('Cancelled');
      cancelErr.code = 'CANCELLED';
      throw cancelErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    cancelSignal?.removeEventListener('abort', onCancel);
  }
}

/**
 * Model output occasionally arrives wrapped in a code fence or with trailing
 * commentary even when JSON mode is requested. Recover the object instead of
 * failing the whole translation.
 */
function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('Empty response from model.');
  }

  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      // fall through
    }
  }

  const err = new Error('Model returned malformed JSON.');
  err.code = 'BAD_JSON';
  throw err;
}

function extractStatus(err) {
  if (!err) return 0;
  const direct = Number(err.status || err.code || err.statusCode);
  if (Number.isInteger(direct) && direct >= 100 && direct < 600) return direct;

  const message = String(err.message || '');
  const fromJson = message.match(/"code"\s*:\s*(\d{3})/);
  if (fromJson) return Number(fromJson[1]);
  const fromText = message.match(/\b(4\d\d|5\d\d)\b/);
  if (fromText) return Number(fromText[1]);
  return 0;
}

function classifyError(err) {
  if (err?.code === 'TIMEOUT') return 'timeout';
  if (err?.code === 'BAD_JSON') return 'bad_json';
  if (String(err?.message || '') === 'Empty response from model.') return 'bad_json';

  const status = extractStatus(err);
  const message = String(err?.message || '').toLowerCase();

  if (status === 429 || message.includes('resource_exhausted') || message.includes('quota')) {
    return 'rate_limit';
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes('overloaded') ||
    message.includes('unavailable') ||
    message.includes('deadline') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('network')
  ) {
    return 'server';
  }
  if (status === 401 || status === 403 || message.includes('api key')) return 'auth';
  if (status === 404 || message.includes('not found') || message.includes('not supported')) {
    return 'model';
  }
  return 'other';
}

function shouldRetrySameModel(kind) {
  return kind === 'rate_limit' || kind === 'server' || kind === 'bad_json';
}

function shortenError(err) {
  const message = err?.message || 'failed';

  try {
    const parsed = JSON.parse(message);
    return parsed?.error?.message || message;
  } catch {
    return message;
  }
}

function describeFailure(entries) {
  const kinds = new Set(entries.map((e) => e.kind));
  let headline;

  if (kinds.size === 1 && kinds.has('rate_limit')) {
    headline = 'Gemini rate limit reached. Wait a minute and try again, or switch to another API key.';
  } else if (kinds.size === 1 && kinds.has('timeout')) {
    headline = 'Gemini did not answer in time. Check your connection and try again.';
  } else if (kinds.has('auth') && kinds.size === 1) {
    headline = 'Gemini rejected the API key. Check it in Settings → API Keys.';
  } else if ([...kinds].every((k) => k === 'server' || k === 'timeout' || k === 'rate_limit')) {
    headline = 'Gemini is busy right now. Try again in a few seconds.';
  } else {
    headline = 'All models failed.';
  }

  const details = entries.map((e) => `${e.model}: ${e.reason}`).join('\n');
  const error = new Error(`${headline}\n${details}`);
  error.kind = kinds.size === 1 ? [...kinds][0] : 'mixed';
  return error;
}

/**
 * Shared driver for every Gemini call: walks the model chain, retries the same
 * model once on transient errors, and aborts requests on timeout.
 *
 * @param {object} options
 * @param {import('@google/genai').GoogleGenAI} options.ai
 * @param {object} options.settings
 * @param {string} options.systemPrompt
 * @param {Array} options.contents
 * @param {object} [options.schema] JSON schema; when omitted, returns plain text
 * @param {(msg: string) => void} [options.onProgress]
 * @param {number} options.timeoutMs
 * @param {string} [options.verb] progress verb, e.g. "Translating"
 * @param {number} [options.hedgeDelayMs] start the next model in parallel after this long
 * @param {boolean} [options.fastThinking] request minimal thinking (structured tasks)
 *
 * Latency on Gemini is dominated by server-side variance (the same request can
 * take 2s or 30s). Instead of waiting for the primary to time out, a "hedge"
 * request is fired on the next model once the primary has been silent for
 * hedgeDelayMs; whichever answers first wins and the rest are aborted.
 */
function runModelChain({
  ai,
  settings,
  systemPrompt,
  contents,
  schema,
  onProgress,
  timeoutMs,
  verb = 'Translating',
  hedgeDelayMs = HEDGE_DELAY_MS,
  fastThinking = Boolean(schema),
}) {
  const modelsToTry = getModelChain(settings);
  if (modelsToTry.length === 0) {
    return Promise.reject(
      new Error('No models configured. Open Settings and select a primary model.')
    );
  }

  const baseConfig = {
    systemInstruction: systemPrompt,
    ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
  };

  const failures = [];
  const cancel = new AbortController();

  /** One model's lane: its own transient retries; resolves with the result. */
  const runLane = async (model) => {
    let useFastThinking = fastThinking && !modelsRejectingThinkingConfig.has(model);

    for (let retry = 0; retry <= MAX_TRANSIENT_RETRIES; retry++) {
      if (cancel.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
      if (retry > 0) onProgress?.(`Retrying ${model}...`);

      const config = useFastThinking
        ? { ...baseConfig, thinkingConfig: { thinkingLevel: 'MINIMAL' } }
        : baseConfig;

      try {
        const response = await requestWithDeadline(
          ai,
          { model, contents, config },
          timeoutMs,
          cancel.signal
        );
        const text = String(response.text || '').trim();
        if (schema) return { parsed: parseJsonLoose(text), model };
        if (!text) throw new Error('Empty response from model.');
        return { text, model };
      } catch (err) {
        if (err?.code === 'CANCELLED') throw err;

        const kind = classifyError(err);

        // Some models reject thinkingConfig with 400; drop it and try again
        // immediately (does not consume the transient-retry budget).
        if (useFastThinking && kind === 'other' && extractStatus(err) === 400) {
          modelsRejectingThinkingConfig.add(model);
          useFastThinking = false;
          retry -= 1;
          continue;
        }

        failures.push({ model, kind, reason: shortenError(err) });
        if (retry < MAX_TRANSIENT_RETRIES && shouldRetrySameModel(kind)) {
          await sleep(RETRY_BASE_DELAY_MS * (retry + 1));
          continue;
        }
        throw Object.assign(new Error(kind), { code: 'LANE_FAILED', kind });
      }
    }
    throw Object.assign(new Error('exhausted'), { code: 'LANE_FAILED', kind: 'other' });
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let nextIndex = 0;
    let active = 0;
    let hedgeTimer = null;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      cancel.abort();
      fn();
    };

    const scheduleHedge = () => {
      clearTimeout(hedgeTimer);
      if (nextIndex >= modelsToTry.length || active >= MAX_CONCURRENT_LANES) return;
      hedgeTimer = setTimeout(() => {
        if (settled || nextIndex >= modelsToTry.length) return;
        onProgress?.(`${modelsToTry[nextIndex - 1]} is slow, also trying ${modelsToTry[nextIndex]}...`);
        launch();
      }, hedgeDelayMs);
    };

    const launch = () => {
      if (settled || nextIndex >= modelsToTry.length) return;
      const index = nextIndex++;
      const model = modelsToTry[index];
      active += 1;

      if (index === 0) {
        onProgress?.(
          modelsToTry.length > 1
            ? `${verb} (1/${modelsToTry.length}): ${model}...`
            : `${verb} with ${model}...`
        );
      }

      runLane(model)
        .then((result) => finish(() => resolve(result)))
        .catch((err) => {
          active -= 1;
          if (settled) return;
          if (nextIndex < modelsToTry.length) {
            if (active === 0) {
              onProgress?.(
                err?.kind === 'timeout'
                  ? `Timed out on ${model}, trying ${modelsToTry[nextIndex]}...`
                  : `${model} failed, trying ${modelsToTry[nextIndex]}...`
              );
              launch();
            } else {
              // Another lane is still running; let the next model hedge it.
              scheduleHedge();
            }
          } else if (active === 0) {
            finish(() => reject(describeFailure(failures)));
          }
        });

      scheduleHedge();
    };

    launch();
  });
}

/** Models that returned 400 for thinkingConfig; remembered for the session. */
const modelsRejectingThinkingConfig = new Set();

function getModelChain(settings) {
  const chain = [settings.primaryModel, ...(settings.fallbackModels || [])].filter(Boolean);
  return [...new Set(chain)];
}

function formatWordResult(parsed, modelUsed, extra = {}) {
  const baseWord = String(parsed.base_word || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

  return {
    layoutMode: 'word',
    translation: parsed.translation ?? '',
    source_text: parsed.source_text ?? '',
    example_sentence: parsed.example_sentence ?? '',
    example_translation: parsed.example_translation ?? '',
    context_explanation: parsed.context_explanation ?? '',
    usage_in_context: parsed.usage_in_context ?? '',
    part_of_speech: parsed.part_of_speech ?? '',
    phonetic_ipa: parsed.phonetic_ipa ?? '',
    base_word: parsed.base_word ?? '',
    source_language: parsed.source_language || 'en',
    dictionaryUrl: `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(baseWord)}`,
    modelUsed,
    ...extra,
  };
}

function parsePairWords(value, source) {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) list = [];

  const fallback = String(source || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return [0, 1]
    .map((index) => {
      const item = list[index] && typeof list[index] === 'object' ? list[index] : {};
      return {
        word: String(item.word || fallback[index] || '').trim(),
        part_of_speech: String(item.part_of_speech || '').trim(),
        meaning: String(item.meaning || '').trim(),
      };
    })
    .filter((item) => item.word || item.meaning);
}

function formatPairResult(parsed, modelUsed, extra = {}) {
  const source = String(parsed.source_text || extra.source_text || extra.sourceText || '').trim();
  const translation = String(parsed.translation || '').trim();

  return {
    layoutMode: 'pair',
    mode: 'pair',
    source_text: source,
    sourceText: source,
    sourceDisplay: source,
    translation,
    why_here: String(parsed.why_here || '').trim(),
    words: parsePairWords(parsed.words, source),
    source_language: parsed.source_language || 'en',
    example_sentence: '',
    example_translation: '',
    context_explanation: '',
    usage_in_context: '',
    part_of_speech: '',
    phonetic_ipa: '',
    base_word: '',
    modelUsed,
    ...extra,
  };
}

function formatPhraseResult(parsed, modelUsed, extra = {}) {
  const source = String(parsed.source_text || extra.source_text || extra.sourceText || '').trim();
  const translation = String(parsed.translation || '').trim();

  return {
    layoutMode: 'phrase',
    mode: 'phrase',
    source_text: source,
    sourceText: source,
    sourceDisplay: source,
    translation,
    source_language: parsed.source_language || 'en',
    example_sentence: '',
    example_translation: '',
    context_explanation: '',
    usage_in_context: '',
    part_of_speech: '',
    phonetic_ipa: '',
    base_word: '',
    modelUsed,
    ...extra,
  };
}

function formatScreenshotResult(parsed, modelUsed) {
  const source = String(parsed.source_text || '').trim();
  const mode = parsed.mode === 'word' ? 'word' : parsed.mode === 'pair' ? 'pair' : 'phrase';

  if (mode === 'pair' || isTwoWordPhrase(source)) {
    return formatPairResult(parsed, modelUsed);
  }

  if (mode === 'phrase') {
    return formatPhraseResult(parsed, modelUsed);
  }

  return formatWordResult(parsed, modelUsed, { mode: 'word' });
}

function requireClient() {
  const settings = loadSettings();
  const apiKey = resolveApiKey(settings);
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Open Settings → API Keys to add one.');
  }
  return { settings, ai: getClient(apiKey) };
}

function userMessage(text, extraParts = []) {
  return [{ role: 'user', parts: [{ text }, ...extraParts] }];
}

/**
 * @param {Buffer} imageBuffer
 * @param {(msg: string) => void} [onProgress]
 * @param {string} [mimeType] image/png or image/jpeg
 */
async function translateScreenshot(imageBuffer, onProgress, mimeType = 'image/png') {
  const { settings, ai } = requireClient();

  const { parsed, model } = await runModelChain({
    ai,
    settings,
    systemPrompt: resolveScreenshotSystemPrompt(settings),
    contents: userMessage(
      'Extract the primary text from this screenshot and return structured JSON. Use mode=pair for exactly two words, with a contextual translation, why that meaning fits, and a detailed description of each word. Use mode=phrase for any sentence or longer text and translate ALL extracted text completely.',
      [{ inlineData: { mimeType, data: imageBuffer.toString('base64') } }]
    ),
    schema: SCREENSHOT_SCHEMA,
    onProgress,
    timeoutMs: PHRASE_TIMEOUT_MS,
    hedgeDelayMs: SCREENSHOT_HEDGE_DELAY_MS,
  });

  return formatScreenshotResult(parsed, model);
}

async function translateText(text, onProgress) {
  const { settings, ai } = requireClient();

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('No text selected.');
  }

  const mode = detectInputMode(trimmed);

  onProgress?.(
    mode === 'phrase' ? 'Translating text...' : mode === 'pair' ? 'Explaining phrase...' : 'Translating word...'
  );

  if (mode === 'pair') {
    const { parsed, model } = await runModelChain({
      ai,
      settings,
      systemPrompt: resolvePairSystemPrompt(settings),
      contents: userMessage(
        `Explain this two-word phrase. Give the contextual translation, why it means that, and a detailed description of each word.\n\n${trimmed}`
      ),
      schema: PAIR_SCHEMA,
      onProgress,
      timeoutMs: PAIR_TIMEOUT_MS,
      hedgeDelayMs: PAIR_HEDGE_DELAY_MS,
      verb: 'Explaining',
    });

    return formatPairResult(parsed, model, {
      sourceText: trimmed,
      source_text: parsed.source_text?.trim() || trimmed,
    });
  }

  if (mode === 'phrase') {
    const { parsed, model } = await runModelChain({
      ai,
      settings,
      systemPrompt: resolvePhraseSystemPrompt(settings),
      contents: userMessage(
        `Translate the following text completely into the target language. Preserve all paragraph breaks.\n\n${trimmed}`
      ),
      schema: TEXT_PHRASE_SCHEMA,
      onProgress,
      timeoutMs: PHRASE_TIMEOUT_MS,
    });

    return formatPhraseResult(parsed, model, {
      sourceText: trimmed,
      source_text: trimmed,
    });
  }

  const { parsed, model } = await runModelChain({
    ai,
    settings,
    systemPrompt: resolveSystemPrompt(settings),
    contents: userMessage(`This is a single word lookup. Return dictionary-style JSON for:\n\n${trimmed}`),
    schema: WORD_SCHEMA,
    onProgress,
    timeoutMs: WORD_TIMEOUT_MS,
  });

  return formatWordResult(parsed, model, { sourceText: trimmed, source_text: trimmed });
}

function resolveReplaceSystemPrompt(settings) {
  const language = settings.replaceLanguage || 'English';
  return `You are an expert professional translator.

Translate the ENTIRE source text into ${language}.

Rules:
- Translate ALL content completely. Never summarize or omit sentences.
- Preserve meaning, tone, register, names, numbers, and formatting intent.
- Preserve paragraph breaks, line breaks, and bullet/list structure from the source.
- Do not add explanations, notes, or commentary outside the translation.
- translation must contain ONLY the translated text in ${language}.`;
}

async function translateForReplace(text, onProgress) {
  const { settings, ai } = requireClient();

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('No text selected.');
  }

  const language = settings.replaceLanguage || 'English';

  onProgress?.(`Translating to ${language}...`);

  const { parsed, model } = await runModelChain({
    ai,
    settings,
    systemPrompt: resolveReplaceSystemPrompt(settings),
    contents: userMessage(
      `Translate the following text completely into ${language}. Preserve all paragraph breaks.\n\n${trimmed}`
    ),
    schema: TEXT_PHRASE_SCHEMA,
    onProgress,
    timeoutMs: PHRASE_TIMEOUT_MS,
  });

  const result = formatPhraseResult(parsed, model, {
    sourceText: trimmed,
    source_text: trimmed,
  });

  if (!result.translation?.trim()) {
    throw new Error('Translation returned empty text.');
  }

  return result;
}

function resolveGrammarSystemPrompt() {
  return `You are an expert multilingual writing editor for native and non-native speakers.

Detect the language of the source text, then correct grammar, spelling, punctuation, word choice, and awkward phrasing IN THAT SAME LANGUAGE.

Rules:
- Work for ANY language (English, Chinese, Japanese, Korean, Spanish, French, mixed text, etc.).
- Always keep the same language as the source. Never translate into another language.
- If the text mixes languages, correct each part in its own language and preserve the mix.
- Keep the original meaning, tone, register, and intent.
- Prefer the smallest natural edits that make the text correct and fluent for that language.
- Preserve paragraph breaks, line breaks, list structure, names, numbers, and formatting intent.
- Do NOT add explanations, notes, labels, or commentary.
- If the text is already correct, return it unchanged.
- corrected_text must contain ONLY the corrected text in the original language(s).
- source_language should be a short language name or BCP-47 code for the primary language detected.`;
}

const GRAMMAR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    source_language: {
      type: Type.STRING,
      description:
        'Detected primary language of the source text, e.g. English, Chinese (Traditional), Japanese, or en / zh-TW / ja.',
    },
    corrected_text: {
      type: Type.STRING,
      description:
        'Grammar-corrected text in the SAME language as the source. Preserve paragraph breaks. Do not translate. Do not add commentary.',
    },
  },
  required: ['source_language', 'corrected_text'],
};

const CHAT_TIMEOUT_MS = 60000;

const ASK_AI_SYSTEM_PROMPT = `You are Luma Ask AI — a fast, helpful desktop assistant.
Answer clearly and directly. Match the user's language unless they ask otherwise.
Use short paragraphs or tight bullet lists when helpful. Do not invent API keys or claim you can control the user's computer.`;

/**
 * Multi-turn chat for Ask AI.
 * @param {{ role: 'user' | 'assistant', content: string }[]} messages
 */
async function chatAsk(messages, onProgress) {
  const { settings, ai } = requireClient();

  const cleaned = (Array.isArray(messages) ? messages : [])
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').trim(),
    }))
    .filter((m) => m.content);

  if (cleaned.length === 0) {
    throw new Error('Type a question first.');
  }

  const contents = cleaned.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  onProgress?.('Thinking…');

  const { text, model } = await runModelChain({
    ai,
    settings,
    systemPrompt: ASK_AI_SYSTEM_PROMPT,
    contents,
    onProgress,
    timeoutMs: CHAT_TIMEOUT_MS,
    hedgeDelayMs: CHAT_HEDGE_DELAY_MS,
    verb: 'Thinking',
  });

  return {
    reply: text,
    modelUsed: model,
  };
}

async function correctGrammarForReplace(text, onProgress) {
  const { settings, ai } = requireClient();

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('No text selected.');
  }

  onProgress?.('Checking grammar…');

  const { parsed, model } = await runModelChain({
    ai,
    settings,
    systemPrompt: resolveGrammarSystemPrompt(),
    contents: userMessage(
      `Detect the language of the following text and correct its grammar and fluency in that same language. Do not translate.\n\n${trimmed}`
    ),
    schema: GRAMMAR_SCHEMA,
    onProgress,
    timeoutMs: PHRASE_TIMEOUT_MS,
    verb: 'Checking',
  });

  const corrected = String(parsed.corrected_text || '').trim();
  if (!corrected) {
    throw new Error('Grammar correction returned empty text.');
  }

  return {
    source_text: parsed.source_text?.trim() || trimmed,
    source_language: parsed.source_language?.trim() || '',
    correctedText: corrected,
    modelUsed: model,
  };
}

module.exports = {
  translateScreenshot,
  translateText,
  translateForReplace,
  correctGrammarForReplace,
  chatAsk,
  detectInputMode,
  WORD_TIMEOUT_MS,
  PHRASE_TIMEOUT_MS,
  CHAT_TIMEOUT_MS,
  /** Exposed for tests only. */
  _internal: { runModelChain, parseJsonLoose, classifyError, describeFailure },
};
