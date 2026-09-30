function isSingleEnglishWord(text) {
  const word = String(text || '').trim();
  if (!word || /\s/.test(word)) return false;
  return /^[a-zA-Z'-]+$/.test(word);
}

function isTwoWordPhrase(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || /[.!?。！？；;:\n]/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length !== 2) return false;
  return words.every((word) => /^[a-zA-Z][a-zA-Z'-]*$/.test(word));
}

/**
 * Detect whether input should use phrase translation, a two-word breakdown, or dictionary word mode.
 * @param {string} text
 * @returns {'word'|'pair'|'phrase'}
 */
function detectInputMode(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'word';

  if (isTwoWordPhrase(trimmed)) return 'pair';

  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length > 1) return 'phrase';
  if (/[\r\n]/.test(trimmed)) return 'phrase';
  if (/[.!?。！？；;:,，、]/.test(trimmed) && trimmed.length > 8) return 'phrase';
  if (trimmed.length > 48) return 'phrase';

  // CJK and other scripts often have no spaces — treat long strings as phrases
  if (!isSingleEnglishWord(trimmed) && trimmed.length > 6) return 'phrase';

  return 'word';
}

function getSourceText(result) {
  return String(result.sourceText || result.source_text || '').trim();
}

/**
 * @param {object} result
 * @returns {'word'|'pair'|'phrase'}
 */
function resolveLayoutMode(result) {
  if (result.layoutMode === 'word' || result.layoutMode === 'pair' || result.layoutMode === 'phrase') {
    return result.layoutMode;
  }

  if (result.mode === 'word' || result.mode === 'pair' || result.mode === 'phrase') {
    return result.mode;
  }

  const source = getSourceText(result);
  if (source) {
    return detectInputMode(source);
  }

  return 'phrase';
}

module.exports = {
  detectInputMode,
  getSourceText,
  resolveLayoutMode,
  isSingleEnglishWord,
  isTwoWordPhrase,
};
