import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhraseResult, PairResult, WordResult, mergePronunciation } from './App';
import { I18nProvider, useI18n } from './i18n';
import './styles.css';

function DictionaryApp() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [copied, setCopied] = useState(null);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const inputRef = useRef(null);
  const audioRef = useRef(null);

  const closeDictionary = useCallback(() => {
    window.electronAPI?.closeDictionary?.();
  }, []);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    document.body.classList.add('popup-page', 'dictionary-page');
    document.documentElement.classList.add('popup-page', 'dictionary-page');
    focusInput();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDictionary();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    const api = window.electronAPI;
    const unsubFocus = api?.onDictionaryFocus?.(() => focusInput());
    api?.onDictionaryPronunciation?.((patch) => {
      setData((prev) => mergePronunciation(prev, patch));
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubFocus?.();
      document.body.classList.remove('popup-page', 'dictionary-page');
      document.documentElement.classList.remove('popup-page', 'dictionary-page');
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [closeDictionary, focusInput]);

  const playAudio = (url, label) => {
    if (!url) return;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(label);
    audio.onended = () => setPlaying(null);
    audio.onerror = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
  };

  const copyText = async (text, label) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  const lookup = async (e) => {
    e?.preventDefault?.();
    const trimmed = query.trim();
    if (!trimmed || state === 'loading') return;

    setState('loading');
    setMessage(t('dictionary.lookingUp'));
    setData(null);
    setPlaying(null);
    setCopied(null);
    setSourceExpanded(false);

    try {
      const result = await window.electronAPI.dictionaryLookup(trimmed);
      setData(result);
      setState('success');
    } catch (err) {
      setState('error');
      setMessage(err?.message || t('dictionary.lookupFailed'));
      setData(null);
    }
  };

  const isPhraseLayout = data?.layoutMode === 'phrase';
  const isPairLayout = data?.layoutMode === 'pair';

  return (
    <div className="popup-shell">
      <div className="popup-card dictionary-card">
        <header className="popup-titlebar">
          <div className="popup-titlebar-drag">{t('dictionary.title')}</div>
          <button
            className="close-btn no-drag"
            onClick={closeDictionary}
            aria-label={t('popup.close')}
          >
            ×
          </button>
        </header>

        <form className="dictionary-search no-drag" onSubmit={lookup}>
          <input
            ref={inputRef}
            className="dictionary-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('dictionary.placeholder')}
            autoFocus
            spellCheck={false}
          />
          <button
            type="submit"
            className="btn-primary dictionary-lookup-btn"
            disabled={!query.trim() || state === 'loading'}
          >
            {state === 'loading' ? t('dictionary.lookingUp') : t('dictionary.lookup')}
          </button>
        </form>

        <div className="dictionary-body">
          {state === 'idle' && (
            <div className="idle-state dictionary-idle">
              <p className="hint">{t('dictionary.idleHint')}</p>
            </div>
          )}

          {state === 'loading' && (
            <div className="loading-state">
              <div className="spinner" />
              <p>{message}</p>
            </div>
          )}

          {state === 'error' && (
            <div className="error-state">
              <p className="error-icon">!</p>
              <p>{message}</p>
            </div>
          )}

          {state === 'success' && data && (
            <div className="result-state">
              {isPairLayout ? (
                <PairResult
                  data={data}
                  playing={playing}
                  copied={copied}
                  onPlaySource={() => playAudio(data.sourceAudioDataUrl, 'source')}
                  onPlayTranslation={() => playAudio(data.translationAudioDataUrl, 'translation')}
                  onCopySource={() =>
                    copyText(data.sourceDisplay || data.sourceText || data.source_text, 'source')
                  }
                  onCopyTranslation={() => copyText(data.translation, 'translation')}
                />
              ) : isPhraseLayout ? (
                <PhraseResult
                  data={data}
                  playing={playing}
                  copied={copied}
                  sourceExpanded={sourceExpanded}
                  onToggleSourceExpand={() => setSourceExpanded((v) => !v)}
                  onPlaySource={() => playAudio(data.sourceAudioDataUrl, 'source')}
                  onPlayTranslation={() =>
                    playAudio(data.translationAudioDataUrl, 'translation')
                  }
                  onCopySource={() =>
                    copyText(
                      data.sourceDisplay || data.sourceText || data.source_text,
                      'source'
                    )
                  }
                  onCopyTranslation={() => copyText(data.translation, 'translation')}
                />
              ) : (
                <WordResult
                  data={data}
                  playing={playing === 'word'}
                  copied={copied === 'translation'}
                  onPlay={() =>
                    playAudio(data.audioDataUrl || data.audioUs || data.audioUk, 'word')
                  }
                  onCopy={() => copyText(data.translation, 'translation')}
                />
              )}

              {data.modelUsed && <p className="model-footer">{data.modelUsed}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <DictionaryApp />
    </I18nProvider>
  </React.StrictMode>
);
