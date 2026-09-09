import { useEffect, useState, useCallback, useRef } from 'react';
import { useI18n } from './i18n';

const SOURCE_COLLAPSE_CHARS = 140;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightWord(text, word) {
  if (!text || !word) return text;

  const pattern = new RegExp(`(${escapeRegExp(word)})`, 'gi');
  const parts = text.split(pattern);

  return parts.map((part, index) =>
    part.toLowerCase() === word.toLowerCase() ? (
      <mark key={index} className="word-highlight">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function SpeakerIcon({ active }) {
  return (
    <svg
      className={`icon-speaker ${active ? 'active' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      className="icon-copy"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ChevronIcon({ up }) {
  return (
    <svg
      className="icon-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {up ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}

function PhraseCard({
  text,
  bold,
  audioUrl,
  audioLoading,
  playing,
  onPlay,
  onCopy,
  copied,
  expand,
  onToggleExpand,
  needsExpand,
}) {
  const { t } = useI18n();
  const displayText =
    !expand && needsExpand ? `${text.slice(0, SOURCE_COLLAPSE_CHARS).trim()}…` : text;
  const showAudio = Boolean(audioUrl || audioLoading);

  return (
    <section className="phrase-card">
      <p className={`phrase-card-text ${bold ? 'phrase-translation' : ''}`}>{displayText}</p>
      <div className="phrase-card-footer">
        <div className="phrase-card-actions">
          {showAudio && (
            <button
              type="button"
              className={`icon-btn ${playing ? 'active' : ''}`}
              onClick={onPlay}
              disabled={!audioUrl}
              aria-label={t('popup.playAudio')}
              title={audioLoading && !audioUrl ? t('progress.loadingAudio') : t('popup.playAudio')}
            >
              {audioLoading && !audioUrl ? (
                <span className="icon-spinner" />
              ) : (
                <SpeakerIcon active={playing} />
              )}
            </button>
          )}
          <button
            type="button"
            className={`icon-btn ${copied ? 'active' : ''}`}
            onClick={onCopy}
            aria-label={t('popup.copyText')}
            title={copied ? t('popup.copied') : t('popup.copy')}
          >
            <CopyIcon />
          </button>
        </div>
        {needsExpand && (
          <button type="button" className="phrase-show-all" onClick={onToggleExpand}>
            {expand ? t('popup.showLess') : t('popup.showAll')}
            <ChevronIcon up={expand} />
          </button>
        )}
      </div>
    </section>
  );
}

export function WordResult({ data, playing, copied, onPlay, onCopy }) {
  const { t } = useI18n();
  const displayWord =
    data.base_word || data.sourceText || data.lookupWord || data.translation || '';
  const highlightTarget = data.base_word || data.sourceText || '';
  const hasAudio = Boolean(data.audioDataUrl || data.audioUs || data.audioUk);
  const audioLoading = Boolean(data.pronunciationLoading) && !hasAudio;
  const showAudio = hasAudio || audioLoading;
  const phoneticDisplay =
    data.phonetic || data.phonetic_ipa
      ? (data.phonetic || data.phonetic_ipa).startsWith('/')
        ? data.phonetic || data.phonetic_ipa
        : `/${data.phonetic || data.phonetic_ipa}/`
      : '';

  return (
    <>
      <header className="word-header">
        <div className="word-title-row">
          <h1 className="word-title">{displayWord}</h1>
          {(phoneticDisplay || showAudio) && (
            <div className="word-phonetic-row">
              {phoneticDisplay && (
                <span className="phonetic-inline">{phoneticDisplay}</span>
              )}
              {showAudio && (
                <button
                  type="button"
                  className={`icon-btn ${playing ? 'active' : ''}`}
                  onClick={onPlay}
                  disabled={!hasAudio}
                  aria-label={t('popup.playPronunciation')}
                  title={
                    audioLoading
                      ? t('progress.loadingPronunciation')
                      : t('popup.playPronunciation')
                  }
                >
                  {audioLoading ? (
                    <span className="icon-spinner" />
                  ) : (
                    <SpeakerIcon active={playing} />
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        <p className="pos-translation">
          {data.part_of_speech && (
            <span className="part-of-speech">{data.part_of_speech}</span>
          )}
          <span className="main-translation">{data.translation}</span>
        </p>
      </header>

      {data.example_sentence && (
        <section className="example-section">
          <p className="example-en">
            {highlightWord(data.example_sentence, highlightTarget)}
          </p>
          {data.example_translation && (
            <p className="example-target">{data.example_translation}</p>
          )}
        </section>
      )}

      {(data.context_explanation || data.usage_in_context) && (
        <section className="context-card">
          <div className="context-card-header">
            <span className="context-word">{data.translation}</span>
            <div className="context-actions">
              {showAudio && (
                <button
                  type="button"
                  className={`icon-btn ${playing ? 'active' : ''}`}
                  onClick={onPlay}
                  disabled={!hasAudio}
                  aria-label={t('popup.playPronunciation')}
                  title={
                    audioLoading
                      ? t('progress.loadingPronunciation')
                      : t('popup.playPronunciation')
                  }
                >
                  {audioLoading ? (
                    <span className="icon-spinner" />
                  ) : (
                    <SpeakerIcon active={playing} />
                  )}
                </button>
              )}
              <button
                type="button"
                className={`icon-btn ${copied ? 'active' : ''}`}
                onClick={onCopy}
                aria-label="Copy translation"
                title={copied ? t('popup.copied') : t('popup.copyTranslation')}
              >
                <CopyIcon />
              </button>
            </div>
          </div>
          {data.context_explanation && (
            <p className="context-text">{data.context_explanation}</p>
          )}
          {data.usage_in_context && (
            <div className="context-usage">
              <span className="context-usage-label">{t('popup.inThisContext')}</span>
              <p className="context-text">{data.usage_in_context}</p>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function PhraseResult({
  data,
  playing,
  copied,
  sourceExpanded,
  onToggleSourceExpand,
  onPlaySource,
  onPlayTranslation,
  onCopySource,
  onCopyTranslation,
}) {
  const source =
    data.sourceDisplay || data.sourceText || data.source_text || '';
  const translation = data.translation || '';
  const needsExpand = source.length > SOURCE_COLLAPSE_CHARS;

  return (
    <div className="phrase-result">
      {source && (
        <PhraseCard
          text={source}
          audioUrl={data.sourceAudioDataUrl}
          audioLoading={data.pronunciationLoading}
          playing={playing === 'source'}
          onPlay={onPlaySource}
          onCopy={onCopySource}
          copied={copied === 'source'}
          expand={sourceExpanded}
          onToggleExpand={onToggleSourceExpand}
          needsExpand={needsExpand}
        />
      )}
      {translation && (
        <PhraseCard
          text={translation}
          bold
          audioUrl={data.translationAudioDataUrl}
          audioLoading={data.pronunciationLoading}
          playing={playing === 'translation'}
          onPlay={onPlayTranslation}
          onCopy={onCopyTranslation}
          copied={copied === 'translation'}
          expand
          needsExpand={false}
        />
      )}
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [data, setData] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [copied, setCopied] = useState(null);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const audioRef = useRef(null);

  const closePopup = useCallback(() => {
    window.electronAPI?.closePopup();
  }, []);

  useEffect(() => {
    document.body.classList.add('popup-page');
    document.documentElement.classList.add('popup-page');
    setMessage(t('popup.translating'));

    const api = window.electronAPI;
    if (!api) return;

    api.onTranslationLoading(({ message: msg }) => {
      setState('loading');
      setMessage(msg || t('popup.translating'));
      setData(null);
      setPlaying(null);
      setCopied(null);
      setSourceExpanded(false);
    });

    api.onTranslationResult((result) => {
      setState('success');
      setData(result);
    });

    api.onTranslationPronunciation((patch) => {
      setData((prev) => (prev ? { ...prev, ...patch } : prev));
    });

    api.onTranslationError(({ message: msg }) => {
      setState('error');
      setMessage(msg || t('popup.error'));
      setData(null);
    });

    return () => {
      document.body.classList.remove('popup-page');
      document.documentElement.classList.remove('popup-page');
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [t]);

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

  const isPhraseLayout = data?.layoutMode === 'phrase';

  return (
    <div className="popup-shell">
      <div className="popup-card">
        <header className="popup-titlebar">
          <div className="popup-titlebar-drag">
            {state === 'loading' ? message : t('app.name')}
          </div>
          <button
            className="close-btn no-drag"
            onClick={closePopup}
            aria-label={t('popup.close')}
          >
            ×
          </button>
        </header>

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
            <button className="btn-secondary" onClick={closePopup}>
              {t('popup.close')}
            </button>
          </div>
        )}

        {state === 'success' && data && (
          <div className="result-state">
            {isPhraseLayout ? (
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

            {data.modelUsed && (
              <p className="model-footer">{data.modelUsed}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
