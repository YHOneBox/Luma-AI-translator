import { useEffect, useState, useCallback } from 'react';
import Settings from './Settings';
import LanguageOnboarding from './LanguageOnboarding';
import WhatsNew from './WhatsNew';
import { formatDisplay } from './HotkeyInput';
import { useI18n } from './i18n';

function ActionButton({ icon, label, hotkey, onClick, primary = false }) {
  return (
    <button
      type="button"
      className={`action-btn${primary ? ' primary' : ''}`}
      onClick={onClick}
    >
      <span className="action-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="action-text">
        <strong>{label}</strong>
        <kbd className="hotkey-chip">{hotkey}</kbd>
      </span>
    </button>
  );
}

export default function MainApp() {
  const { t, ready } = useI18n();
  const [view, setView] = useState('home');
  const [appVersion, setAppVersion] = useState('');
  const [needsOnboarding, setNeedsOnboarding] = useState(null);
  const [hotkeys, setHotkeys] = useState({
    screen: 'Alt + T',
    region: 'Alt + C',
    selection: 'Alt + X',
    replace: 'Alt + R',
    grammar: 'Alt + G',
    dictionary: 'Alt + D',
    ask: 'Alt + A',
  });

  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null);

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then((v) => {
      if (v) setAppVersion(v);
    });
  }, []);

  useEffect(() => {
    const unsubAvailable = window.electronAPI?.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
    });
    const unsubProgress = window.electronAPI?.onUpdateProgress?.((progress) => {
      setUpdateProgress(progress);
    });
    return () => {
      unsubAvailable?.();
      unsubProgress?.();
    };
  }, []);

  useEffect(() => {
    window.electronAPI?.getSettings().then((s) => {
      setNeedsOnboarding(!s.hasChosenUiLocale);
      setHotkeys({
        screen: formatDisplay(s.hotkeyScreen),
        region: formatDisplay(s.hotkeyRegion),
        selection: formatDisplay(s.hotkeySelection),
        replace: formatDisplay(s.hotkeyReplace),
        grammar: formatDisplay(s.hotkeyGrammar),
        dictionary: formatDisplay(s.hotkeyDictionary),
        ask: formatDisplay(s.hotkeyAsk),
      });
    });
  }, [view, ready]);

  const translateScreen = useCallback(() => {
    window.electronAPI?.translateScreen();
  }, []);

  const translateRegion = useCallback(() => {
    window.electronAPI?.translateRegion();
  }, []);

  const translateSelection = useCallback(() => {
    window.electronAPI?.translateSelection();
  }, []);

  const translateReplace = useCallback(() => {
    window.electronAPI?.translateReplace();
  }, []);

  const translateGrammar = useCallback(() => {
    window.electronAPI?.translateGrammar();
  }, []);

  const showDictionary = useCallback(() => {
    window.electronAPI?.showDictionary();
  }, []);

  const showAsk = useCallback(() => {
    window.electronAPI?.showAsk();
  }, []);

  const installUpdate = useCallback(async () => {
    setUpdateProgress({ percent: 0, installing: true });
    const result = await window.electronAPI.installUpdate();
    if (result?.error) {
      setUpdateProgress(null);
      setView('whats-new');
    }
  }, []);

  if (needsOnboarding === null || !ready) {
    return (
      <div className="main-app">
        <div className="loading-state">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (needsOnboarding) {
    return <LanguageOnboarding onComplete={() => setNeedsOnboarding(false)} />;
  }

  if (view === 'settings') {
    return <Settings onBack={() => setView('home')} />;
  }

  if (view === 'whats-new') {
    return <WhatsNew onBack={() => setView('home')} />;
  }

  return (
    <div className="main-app">
      <header className="main-header">
        <img src="./logo.png" alt="" className="main-logo" />
        <div className="header-text">
          <div className="header-title-row">
            <h1>{t('app.name')}</h1>
            {appVersion ? <span className="version-pill">v{appVersion}</span> : null}
          </div>
          <p className="subtitle">{t('app.subtitle')}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setView('whats-new')}
            aria-label={t('app.whatsNew')}
            title={t('app.whatsNew')}
          >
            ✶
          </button>
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => setView('settings')}
            aria-label={t('app.settings')}
            title={t('app.settings')}
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="main-scroll">
        {updateInfo?.updateAvailable ? (
          <div className="update-banner">
            <div className="update-banner-copy">
              <strong>{t('updates.available', { version: updateInfo.latestVersion })}</strong>
              {updateProgress?.installing ? (
                <p>
                  {updateProgress.percent >= 100
                    ? t('updates.restarting')
                    : t('updates.progress', { percent: updateProgress.percent || 0 })}
                </p>
              ) : (
                <p>{t('updates.portableHint')}</p>
              )}
            </div>
            <div className="update-banner-actions">
              <button
                type="button"
                className="btn-primary small"
                onClick={installUpdate}
                disabled={Boolean(updateProgress?.installing)}
              >
                {updateProgress?.installing ? t('updates.installing') : t('updates.install')}
              </button>
              <button
                type="button"
                className="btn-secondary small"
                onClick={() => setUpdateInfo(null)}
                disabled={Boolean(updateProgress?.installing)}
              >
                {t('updates.bannerLater')}
              </button>
            </div>
          </div>
        ) : null}
        <section className="action-group" aria-labelledby="group-capture">
          <h2 id="group-capture" className="action-group-title">
            {t('app.groups.capture')}
          </h2>
          <div className="action-grid">
            <ActionButton
              icon="⬚"
              label={t('app.actions.translateScreen')}
              hotkey={hotkeys.screen}
              onClick={translateScreen}
              primary
            />
            <ActionButton
              icon="◫"
              label={t('app.actions.selectRegion')}
              hotkey={hotkeys.region}
              onClick={translateRegion}
            />
          </div>
        </section>

        <section className="action-group" aria-labelledby="group-selection">
          <h2 id="group-selection" className="action-group-title">
            {t('app.groups.selection')}
          </h2>
          <div className="action-grid">
            <ActionButton
              icon="T"
              label={t('app.actions.translateSelection')}
              hotkey={hotkeys.selection}
              onClick={translateSelection}
            />
            <ActionButton
              icon="⇄"
              label={t('app.actions.replaceSelection')}
              hotkey={hotkeys.replace}
              onClick={translateReplace}
            />
            <ActionButton
              icon="✎"
              label={t('app.actions.fixGrammar')}
              hotkey={hotkeys.grammar}
              onClick={translateGrammar}
            />
          </div>
        </section>

        <section className="action-group" aria-labelledby="group-tools">
          <h2 id="group-tools" className="action-group-title">
            {t('app.groups.tools')}
          </h2>
          <div className="action-grid">
            <ActionButton
              icon="⌕"
              label={t('app.actions.dictionary')}
              hotkey={hotkeys.dictionary}
              onClick={showDictionary}
            />
            <ActionButton
              icon="✦"
              label={t('app.actions.ask')}
              hotkey={hotkeys.ask}
              onClick={showAsk}
            />
          </div>
        </section>

        <section className="home-tips" aria-label={t('app.tipsTitle')}>
          <h2 className="action-group-title">{t('app.tipsTitle')}</h2>
          <ul className="tip-list">
            <li>{t('app.hints.popup')}</li>
            <li>{t('app.hints.workflows')}</li>
            <li>{t('app.hints.tray')}</li>
          </ul>
        </section>
      </div>

      <footer className="main-footer">
        <span>{t('app.footerHotkeys')}</span>
        <span className="footer-sep">·</span>
        <a
          href="https://yhonebox.github.io/e-portfolio/"
          onClick={(e) => {
            e.preventDefault();
            window.electronAPI?.openDictionary(
              'https://yhonebox.github.io/e-portfolio/'
            );
          }}
        >
          {t('app.by')} Yi-Ho Chang
        </a>
      </footer>
    </div>
  );
}
