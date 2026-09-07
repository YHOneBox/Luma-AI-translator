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

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then((v) => {
      if (v) setAppVersion(v);
    });
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
