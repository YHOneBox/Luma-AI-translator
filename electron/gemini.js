const { GoogleGenAI, Type } = require('@google/genai');
const { loadSettings, resolveSystemPrompt } = require('./settings');
const { resolveApiKey } = require('./api-keys');
const { detectInputMode, isTwoWordPhrase } = require('./translate-mode');

const WORD_TIMEOUT_MS = 10000;
const PAIR_TIMEOUT_MS = 20000;
const PHRASE_TIMEOUT_MS = 25000;

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
- source_text must match the original input exactly (fix obvious OCR errors only if needed).
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

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

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

function shortenError(err) {
  const message = err?.message || 'failed';

  try {
    const parsed = JSON.parse(message);
    return parsed?.error?.message || message;
  } catch {
    return message;
  }
}

async function generateWithFallback(
  ai,
  settings,
  systemPrompt,
  contents,
  schema,
  onProgress,
  timeoutMs = WORD_TIMEOUT_MS
) {
  const modelsToTry = getModelChain(settings);
  if (modelsToTry.length === 0) {
    throw new Error('No models configured. Open Settings and select a primary model.');
  }

  const errors = [];

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const attempt = i + 1;

    onProgress?.(
      modelsToTry.length > 1
        ? `Translating (${attempt}/${modelsToTry.length}): ${model}...`
        : `Translating with ${model}...`
    );

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
          },
        }),
        timeoutMs,
        `Timed out after ${timeoutMs / 1000}s`
      );

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from model.');
      }

      return { parsed: JSON.parse(text), model };
    } catch (err) {
      const reason = shortenError(err);
      errors.push(`${model}: ${reason}`);

      const nextModel = modelsToTry[i + 1];
      if (nextModel && reason.includes('Timed out')) {
        onProgress?.(`Timed out on ${model}, trying ${nextModel}...`);
      }
    }
  }

  throw new Error(`All models failed:\n${errors.join('\n')}`);
}

async function translateScreenshot(imageBuffer, onProgress) {
  const settings = loadSettings();
  const apiKey = resolveApiKey(settings);
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Open Settings → API Keys to add one.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const { parsed, model } = await generateWithFallback(
    ai,
    settings,
    resolveScreenshotSystemPrompt(settings),
    [
      {
        role: 'user',
        parts: [
          {
            text: 'Extract the primary text from this screenshot and return structured JSON. Use mode=pair for exactly two words, with a contextual translation, why that meaning fits, and a detailed description of each word. Use mode=phrase for any sentence or longer text and translate ALL extracted text completely.',
          },
          {
            inlineData: {
              mimeType: 'image/png',
              data: imageBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
    SCREENSHOT_SCHEMA,
    onProgress,
    PHRASE_TIMEOUT_MS
  );

  return formatScreenshotResult(parsed, model);
}

async function translateText(text, onProgress) {
  const settings = loadSettings();
  const apiKey = resolveApiKey(settings);
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Open Settings → API Keys to add one.');
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('No text selected.');
  }

  const mode = detectInputMode(trimmed);
  const ai = new GoogleGenAI({ apiKey });

  onProgress?.(
    mode === 'phrase' ? 'Translating text...' : mode === 'pair' ? 'Explaining phrase...' : 'Translating word...'
  );

  if (mode === 'pair') {
    const { parsed, model } = await generateWithFallback(
      ai,
      settings,
      resolvePairSystemPrompt(settings),
      [
        {
          role: 'user',
          parts: [
            {
              text: `Explain this two-word phrase. Give the contextual translation, why it means that, and a detailed description of each word.\n\n${trimmed}`,
            },
          ],
        },
      ],
      PAIR_SCHEMA,
      onProgress,
      PAIR_TIMEOUT_MS
    );

    return formatPairResult(parsed, model, {
      sourceText: trimmed,
      source_text: parsed.source_text?.trim() || trimmed,
    });
  }

  if (mode === 'phrase') {
    const { parsed, model } = await generateWithFallback(
      ai,
      settings,
      resolvePhraseSystemPrompt(settings),
      [
        {
          role: 'user',
          parts: [
            {
              text: `Translate the following text completely into the target language. Preserve all paragraph breaks.\n\n${trimmed}`,
            },
          ],
        },
      ],
      PHRASE_SCHEMA,
      onProgress,
      PHRASE_TIMEOUT_MS
    );

    return formatPhraseResult(parsed, model, {
      sourceText: trimmed,
      source_text: parsed.source_text?.trim() || trimmed,
    });
  }

  const { parsed, model } = await generateWithFallback(
    ai,
    settings,
    resolveSystemPrompt(settings),
    [
      {
        role: 'user',
        parts: [
          {
            text: `This is a single word lookup. Return dictionary-style JSON for:\n\n${trimmed}`,
          },
        ],
      },
    ],
    WORD_SCHEMA,
    onProgress,
    WORD_TIMEOUT_MS
  );

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
- source_text must match the original input exactly.
- translation must contain ONLY the translated text in ${language}.`;
}

async function translateForReplace(text, onProgress) {
  const settings = loadSettings();
  const apiKey = resolveApiKey(settings);
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Open Settings → API Keys to add one.');
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('No text selected.');
  }

  const language = settings.replaceLanguage || 'English';
  const ai = new GoogleGenAI({ apiKey });

  onProgress?.(`Translating to ${language}...`);

  const { parsed, model } = await generateWithFallback(
    ai,
    settings,
    resolveReplaceSystemPrompt(settings),
    [
      {
        role: 'user',
        parts: [
          {
            text: `Translate the following text completely into ${language}. Preserve all paragraph breaks.\n\n${trimmed}`,
          },
        ],
      },
    ],
    PHRASE_SCHEMA,
    onProgress,
    PHRASE_TIMEOUT_MS
  );

  const result = formatPhraseResult(parsed, model, {
    sourceText: trimmed,
    source_text: parsed.source_text?.trim() || trimmed,
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
- source_text must match the original input exactly.
- corrected_text must contain ONLY the corrected text in the original language(s).
- source_language should be a short language name or BCP-47 code for the primary language detected.`;
}

const GRAMMAR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    source_text: {
      type: Type.STRING,
      description: 'The original text exactly as provided.',
    },
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
  required: ['source_text', 'source_language', 'corrected_text'],
};

const CHAT_TIMEOUT_MS = 60000;

const ASK_AI_SYSTEM_PROMPT = `You are Luma Ask AI — a fast, helpful desktop assistant.
Answer clearly and directly. Match the user's language unless they ask otherwise.
Use short paragraphs or tight bullet lists when helpful. Do not invent API keys or claim you can control the user's computer.`;

async function generateTextWithFallback(ai, settings, systemPrompt, contents, onProgress, timeoutMs) {
  const modelsToTry = getModelChain(settings);
  if (modelsToTry.length === 0) {
    throw new Error('No models configured. Open Settings and select a primary model.');
  }

  const errors = [];

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const attempt = i + 1;

    onProgress?.(
      modelsToTry.length > 1
        ? `Thinking (${attempt}/${modelsToTry.length}): ${model}...`
        : `Thinking with ${model}...`
    );

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
          },
        }),
        timeoutMs,
        `Timed out after ${timeoutMs / 1000}s`
      );

      const text = String(response.text || '').trim();
      if (!text) {
        throw new Error('Empty response from model.');
      }

      return { text, model };
    } catch (err) {
      const reason = shortenError(err);
      errors.push(`${model}: ${reason}`);

      const nextModel = modelsToTry[i + 1];
      if (nextModel && reason.includes('Timed out')) {
        onProgress?.(`Timed out on ${model}, trying ${nextModel}...`);
      }
    }
  }

  throw new Error(`All models failed:\n${errors.join('\n')}`);
}

/**
 * Multi-turn chat for Ask AI.
 * @param {{ role: 'user' | 'assistant', content: string }[]} messages
 */
async function chatAsk(messages, onProgress) {
  const settings = loadSettings();
  const apiKey = resolveApiKey(settings);
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Open Settings → API Keys to add one.');
  }

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

  const ai = new GoogleGenAI({ apiKey });
  onProgress?.('Thinking…');

  const { text, model } = await generateTextWithFallback(
    ai,
    settings,
    ASK_AI_SYSTEM_PROMPT,
    contents,
    onProgress,
    CHAT_TIMEOUT_MS
  );

  return {
    reply: text,
    modelUsed: model,
  };
}

async function correctGrammarForReplace(text, onProgress) {
  const settings = loadSettings();
  const apiKey = resolveApiKey(settings);
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Open Settings → API Keys to add one.');
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('No text selected.');
  }

  const ai = new GoogleGenAI({ apiKey });
  onProgress?.('Checking grammar…');

  const { parsed, model } = await generateWithFallback(
    ai,
    settings,
    resolveGrammarSystemPrompt(),
    [
      {
        role: 'user',
        parts: [
          {
            text: `Detect the language of the following text and correct its grammar and fluency in that same language. Do not translate.\n\n${trimmed}`,
          },
        ],
      },
    ],
    GRAMMAR_SCHEMA,
    onProgress,
    PHRASE_TIMEOUT_MS
  );

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
};
