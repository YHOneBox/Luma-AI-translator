import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, useI18n } from './i18n';
import MarkdownContent from './MarkdownContent';
import './styles.css';

function AskApp() {
  const { t } = useI18n();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [modelUsed, setModelUsed] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const closeAsk = useCallback(() => {
    window.electronAPI?.closeAsk?.();
  }, []);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    document.body.classList.add('popup-page', 'ask-page');
    document.documentElement.classList.add('popup-page', 'ask-page');
    focusInput();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAsk();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    const unsubFocus = window.electronAPI?.onAskFocus?.(() => focusInput());

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubFocus?.();
      document.body.classList.remove('popup-page', 'ask-page');
      document.documentElement.classList.remove('popup-page', 'ask-page');
    };
  }, [closeAsk, focusInput]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending, error]);

  const clearChat = () => {
    if (sending) return;
    setMessages([]);
    setError('');
    setModelUsed('');
    focusInput();
  };

  const send = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text || sending) return;

    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    setError('');

    try {
      const result = await window.electronAPI.askChat(nextMessages);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.reply },
      ]);
      setModelUsed(result.modelUsed || '');
    } catch (err) {
      setError(err?.message || t('ask.failed'));
    } finally {
      setSending(false);
      focusInput();
    }
  };

  const onComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="popup-shell">
      <div className="popup-card ask-card">
        <header className="popup-titlebar">
          <div className="popup-titlebar-drag">{t('ask.title')}</div>
          <button
            type="button"
            className="close-btn no-drag"
            onClick={closeAsk}
            aria-label={t('popup.close')}
            title={t('popup.close')}
          >
            ×
          </button>
        </header>

        <div className="ask-body" ref={listRef}>
          {messages.length === 0 && !sending && !error && (
            <div className="idle-state ask-idle">
              <p className="hint">{t('ask.idleHint')}</p>
            </div>
          )}

          {messages.map((msg, index) => (
            <div
              key={`${msg.role}-${index}`}
              className={`ask-bubble ask-bubble-${msg.role}`}
            >
              <span className="ask-role">
                {msg.role === 'user' ? t('ask.you') : t('ask.assistant')}
              </span>
              {msg.role === 'assistant' ? (
                <MarkdownContent>{msg.content}</MarkdownContent>
              ) : (
                <p className="ask-text">{msg.content}</p>
              )}
            </div>
          ))}

          {sending && (
            <div className="ask-bubble ask-bubble-assistant ask-thinking">
              <span className="ask-role">{t('ask.assistant')}</span>
              <p className="ask-text">{t('ask.thinking')}</p>
            </div>
          )}

          {error && (
            <div className="ask-error">
              <p>{error}</p>
            </div>
          )}
        </div>

        <form className="ask-composer no-drag" onSubmit={send}>
          <textarea
            ref={inputRef}
            className="ask-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={t('ask.placeholder')}
            rows={2}
            disabled={sending}
            spellCheck
          />
          <div className="ask-composer-actions">
            <button
              type="button"
              className="btn-secondary small ask-clear-btn"
              onClick={clearChat}
              disabled={sending || messages.length === 0}
            >
              {t('ask.clear')}
            </button>
            <button
              type="submit"
              className="btn-primary ask-send-btn"
              disabled={sending || !draft.trim()}
            >
              {sending ? t('ask.thinking') : t('ask.send')}
            </button>
          </div>
        </form>

        {modelUsed ? <p className="model-footer ask-model">{modelUsed}</p> : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <AskApp />
    </I18nProvider>
  </React.StrictMode>
);
