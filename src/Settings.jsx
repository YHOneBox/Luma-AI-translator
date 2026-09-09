import { useEffect, useState, useCallback } from 'react';
import ModelSelect from './ModelSelect';
import HotkeyInput from './HotkeyInput';
import { useI18n } from './i18n';

export default function Settings({ onBack }) {
  const { t, locales, setLocale, locale } = useI18n();
  const [settings, setSettings] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [models, setModels] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [addingKey, setAddingKey] = useState(false);
  const [showAddKeyForm, setShowAddKeyForm] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;

    const [current, defaultSettings] = await Promise.all([
      api.getSettings(),
      api.getDefaultSettings(),
    ]);
    setSettings(current);
    setDefaults(defaultSettings);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateField = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const scanModels = async () => {
    setScanning(true);
    setStatus('');
    try {
      const list = await window.electronAPI.scanModels();
      setModels(list);
      setStatus(t('settings.status.modelsFound', { count: list.length }));
    } catch (err) {
      setStatus(err.message || t('settings.status.scanFailed'));
    } finally {
      setScanning(false);
    }
  };

  const toggleFallback = (modelId) => {
    setSettings((prev) => {
      const current = prev.fallbackModels || [];
      const next = current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : [...current, modelId];
      return { ...prev, fallbackModels: next };
    });
  };

  const moveFallback = (modelId, direction) => {
    setSettings((prev) => {
      const list = [...(prev.fallbackModels || [])];
      const index = list.indexOf(modelId);
      if (index === -1) return prev;

      const target = index + direction;
      if (target < 0 || target >= list.length) return prev;

      [list[index], list[target]] = [list[target], list[index]];
      return { ...prev, fallbackModels: list };
    });
  };

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      const saved = await window.electronAPI.saveSettings(settings);
      setSettings(saved);
      setStatus(t('settings.status.saved'));
    } catch (err) {
      setStatus(err.message || t('settings.status.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const resetPrompt = () => {
    if (defaults) {
      updateField('systemPrompt', defaults.systemPrompt);
    }
  };

  const resetAll = async () => {
    const reset = await window.electronAPI.resetSettings();
    setSettings(reset);
    if (reset.uiLocale) {
      await setLocale(reset.uiLocale, { markChosen: true });
    }
    setStatus(t('settings.status.reset'));
  };

  const saveHotkey = async (key, value) => {
    if (!settings) return;

    const next = { ...settings, [key]: value };
    setSettings(next);

    try {
      const saved = await window.electronAPI.saveSettings(next);
      setSettings(saved);
      setStatus(t('settings.status.hotkeySaved'));
    } catch (err) {
      setStatus(err.message || t('settings.status.hotkeySaveFailed'));
    }
  };

  const resetHotkey = async (key, defaultVal) => {
    if (!settings || !defaultVal) return;

    const next = { ...settings, [key]: defaultVal };
    setSettings(next);

    try {
      const saved = await window.electronAPI.saveSettings(next);
      setSettings(saved);
      setStatus(t('settings.status.hotkeyReset'));
    } catch (err) {
      setStatus(err.message || t('settings.status.hotkeyResetFailed'));
    }
  };

  const resetAllHotkeys = async () => {
    if (!settings || !defaults) return;

    const next = {
      ...settings,
      hotkeyScreen: defaults.hotkeyScreen,
      hotkeyRegion: defaults.hotkeyRegion,
      hotkeySelection: defaults.hotkeySelection,
      hotkeyReplace: defaults.hotkeyReplace,
      hotkeyGrammar: defaults.hotkeyGrammar,
      hotkeyDictionary: defaults.hotkeyDictionary,
      hotkeyAsk: defaults.hotkeyAsk,
    };

    try {
      const saved = await window.electronAPI.saveSettings(next);
      setSettings(saved);
      setStatus(t('settings.status.hotkeysReset'));
    } catch (err) {
      setStatus(err.message || t('settings.status.hotkeysResetFailed'));
    }
  };

  const changeUiLanguage = async (code) => {
    updateField('uiLocale', code);
    await setLocale(code, { markChosen: true });
    const current = await window.electronAPI.getSettings();
    setSettings(current);
  };

  const saveLaunchAtStartup = async (enabled) => {
    if (!settings) return;
    const next = { ...settings, launchAtStartup: enabled };
    setSettings(next);
    try {
      const saved = await window.electronAPI.saveSettings(next);
      setSettings(saved);
      setStatus(
        enabled
          ? t('settings.status.startupEnabled')
          : t('settings.status.startupDisabled')
      );
    } catch (err) {
      setStatus(err.message || t('settings.status.saveFailed'));
    }
  };

  const addApiKey = async () => {
    if (!newKeyValue.trim()) {
      setStatus(t('settings.status.enterApiKey'));
      return;
    }

    setAddingKey(true);
    setStatus('');
    try {
      const saved = await window.electronAPI.addApiKey({
        label: newKeyLabel.trim() || 'API Key',
        key: newKeyValue.trim(),
      });
      setSettings(saved);
      setNewKeyLabel('');
      setNewKeyValue('');
      setShowAddKeyForm(false);
      setStatus(t('settings.status.apiKeyAdded'));
    } catch (err) {
      setStatus(err.message || t('settings.status.apiKeyAddFailed'));
    } finally {
      setAddingKey(false);
    }
  };

  const cancelAddApiKey = () => {
    setShowAddKeyForm(false);
    setNewKeyLabel('');
    setNewKeyValue('');
  };

  const activateApiKey = async (id) => {
    setStatus('');
    try {
      const saved = await window.electronAPI.setActiveApiKey(id);
      setSettings(saved);
      setStatus(t('settings.status.apiKeyActive'));
    } catch (err) {
      setStatus(err.message || t('settings.status.apiKeyActiveFailed'));
    }
  };

  const deleteApiKey = async (id) => {
    setStatus('');
    try {
      const saved = await window.electronAPI.removeApiKey(id);
      setSettings(saved);
      setStatus(t('settings.status.apiKeyRemoved'));
    } catch (err) {
      setStatus(err.message || t('settings.status.apiKeyRemoveFailed'));
    }
  };

  if (!settings) {
    return (
      <div className="settings-page">
        <div className="loading-state">
          <div className="spinner" />
          <p>{t('settings.loading')}</p>
        </div>
      </div>
    );
  }

  const modelOptions =
    models.length > 0
      ? models
      : [
          { id: settings.primaryModel, displayName: settings.primaryModel },
          ...(settings.fallbackModels || []).map((id) => ({ id, displayName: id })),
        ];

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button className="back-btn" onClick={onBack} aria-label={t('settings.back')}>
          ←
        </button>
        <h1>{t('settings.title')}</h1>
      </header>

      <div className="settings-body">
        <section className="settings-section">
          <h2>{t('settings.sections.appearance')}</h2>
          <label className="field">
            <span>{t('settings.appearance.uiLanguage')}</span>
            <select
              value={settings.uiLocale || locale || 'en'}
              onChange={(e) => changeUiLanguage(e.target.value)}
            >
              {(locales || []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.nativeName} — {item.englishName}
                </option>
              ))}
            </select>
            <small>{t('settings.appearance.uiLanguageHint')}</small>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={Boolean(settings.launchAtStartup)}
              onChange={(e) => saveLaunchAtStartup(e.target.checked)}
            />
            <span className="toggle-copy">
              <strong>{t('settings.appearance.launchAtStartup')}</strong>
              <small>{t('settings.appearance.launchAtStartupHint')}</small>
            </span>
          </label>
        </section>

        <section className="settings-section">
          <h2>{t('settings.sections.apiKeys')}</h2>
          <small className="settings-section-hint">
            {t('settings.apiKeys.hintBefore')}{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.electronAPI?.openDictionary('https://aistudio.google.com/apikey');
              }}
            >
              {t('settings.apiKeys.hintLink')}
            </a>
            {t('settings.apiKeys.hintAfter')}
          </small>

          {settings.hasEnvApiKey && (settings.apiKeys?.length ?? 0) === 0 && (
            <p className="settings-note api-key-env-note">
              {t('settings.apiKeys.envNote')}
            </p>
          )}

          {(settings.apiKeys?.length ?? 0) > 0 ? (
            <ul className="api-key-list">
              {settings.apiKeys.map((entry) => (
                <li key={entry.id} className={entry.isActive ? 'active' : ''}>
                  <label className="api-key-radio">
                    <input
                      type="radio"
                      name="activeApiKey"
                      checked={entry.isActive}
                      onChange={() => activateApiKey(entry.id)}
                    />
                    <span className="api-key-meta">
                      <strong>{entry.label}</strong>
                      <span className="api-key-mask">{entry.maskedKey}</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="btn-secondary small api-key-delete"
                    onClick={() => deleteApiKey(entry.id)}
                  >
                    {t('settings.apiKeys.remove')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-note">{t('settings.apiKeys.empty')}</p>
          )}

          {showAddKeyForm ? (
            <div className="api-key-add">
              <label className="field">
                <span>{t('settings.apiKeys.labelOptional')}</span>
                <input
                  type="text"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder={t('settings.apiKeys.labelPlaceholder')}
                  autoFocus
                />
              </label>
              <label className="field">
                <span>{t('settings.apiKeys.geminiKey')}</span>
                <input
                  type="password"
                  value={newKeyValue}
                  onChange={(e) => setNewKeyValue(e.target.value)}
                  placeholder="AIza..."
                  autoComplete="off"
                />
              </label>
              <div className="api-key-add-actions">
                <button
                  type="button"
                  className="btn-secondary small"
                  onClick={cancelAddApiKey}
                  disabled={addingKey}
                >
                  {t('settings.apiKeys.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-primary small"
                  onClick={addApiKey}
                  disabled={addingKey}
                >
                  {addingKey ? t('settings.apiKeys.adding') : t('settings.apiKeys.saveKey')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn-secondary small"
              onClick={() => setShowAddKeyForm(true)}
            >
              {t('settings.apiKeys.add')}
            </button>
          )}
        </section>

        <section className="settings-section">
          <h2>{t('settings.sections.basic')}</h2>

          <label className="field">
            <span>{t('settings.basic.targetLanguage')}</span>
            <input
              type="text"
              value={settings.targetLanguage}
              onChange={(e) => updateField('targetLanguage', e.target.value)}
              placeholder="Chinese (Traditional)"
            />
            <small>{t('settings.basic.targetHint')}</small>
          </label>

          <label className="field">
            <span>{t('settings.basic.replaceLanguage')}</span>
            <input
              type="text"
              value={settings.replaceLanguage || ''}
              onChange={(e) => updateField('replaceLanguage', e.target.value)}
              placeholder="English"
            />
            <small>{t('settings.basic.replaceHint')}</small>
          </label>
        </section>

        <section className="settings-section">
          <div className="section-row">
            <h2>{t('settings.sections.hotkeys')}</h2>
            <button
              type="button"
              className="btn-secondary small"
              onClick={resetAllHotkeys}
            >
              {t('settings.hotkeys.resetAll')}
            </button>
          </div>
          <small className="settings-section-hint">
            {t('settings.hotkeys.hintBefore')}{' '}
            <strong>{t('settings.hotkeys.hintStrong')}</strong>
            {t('settings.hotkeys.hintAfter')}
          </small>

          <HotkeyInput
            label={t('settings.hotkeys.screen')}
            value={settings.hotkeyScreen}
            defaultValue={defaults?.hotkeyScreen}
            onChange={(v) => saveHotkey('hotkeyScreen', v)}
            onReset={() => resetHotkey('hotkeyScreen', defaults?.hotkeyScreen)}
          />
          <HotkeyInput
            label={t('settings.hotkeys.region')}
            value={settings.hotkeyRegion}
            defaultValue={defaults?.hotkeyRegion}
            onChange={(v) => saveHotkey('hotkeyRegion', v)}
            onReset={() => resetHotkey('hotkeyRegion', defaults?.hotkeyRegion)}
          />
          <HotkeyInput
            label={t('settings.hotkeys.selection')}
            value={settings.hotkeySelection}
            defaultValue={defaults?.hotkeySelection}
            onChange={(v) => saveHotkey('hotkeySelection', v)}
            onReset={() => resetHotkey('hotkeySelection', defaults?.hotkeySelection)}
          />
          <HotkeyInput
            label={t('settings.hotkeys.replace')}
            value={settings.hotkeyReplace}
            defaultValue={defaults?.hotkeyReplace}
            onChange={(v) => saveHotkey('hotkeyReplace', v)}
            onReset={() => resetHotkey('hotkeyReplace', defaults?.hotkeyReplace)}
          />
          <HotkeyInput
            label={t('settings.hotkeys.grammar')}
            value={settings.hotkeyGrammar}
            defaultValue={defaults?.hotkeyGrammar}
            onChange={(v) => saveHotkey('hotkeyGrammar', v)}
            onReset={() => resetHotkey('hotkeyGrammar', defaults?.hotkeyGrammar)}
          />
          <HotkeyInput
            label={t('settings.hotkeys.dictionary')}
            value={settings.hotkeyDictionary}
            defaultValue={defaults?.hotkeyDictionary}
            onChange={(v) => saveHotkey('hotkeyDictionary', v)}
            onReset={() => resetHotkey('hotkeyDictionary', defaults?.hotkeyDictionary)}
          />
          <HotkeyInput
            label={t('settings.hotkeys.ask')}
            value={settings.hotkeyAsk}
            defaultValue={defaults?.hotkeyAsk}
            onChange={(v) => saveHotkey('hotkeyAsk', v)}
            onReset={() => resetHotkey('hotkeyAsk', defaults?.hotkeyAsk)}
          />
        </section>

        <section className="settings-section">
          <div className="section-row">
            <h2>{t('settings.sections.models')}</h2>
            <button
              className="btn-secondary small"
              onClick={scanModels}
              disabled={scanning}
            >
              {scanning ? t('settings.models.scanning') : t('settings.models.scan')}
            </button>
          </div>

          <label className="field">
            <span>{t('settings.models.primary')}</span>
            <ModelSelect
              value={settings.primaryModel}
              options={modelOptions}
              onChange={(id) => updateField('primaryModel', id)}
              placeholder={t('settings.models.primaryPlaceholder')}
            />
          </label>

          <div className="field">
            <span>{t('settings.models.fallback')}</span>
            <small>{t('settings.models.fallbackHint')}</small>

            {modelOptions.length === 0 ? (
              <p className="settings-note">{t('settings.models.fallbackEmpty')}</p>
            ) : (
              <ul className="fallback-list">
                {modelOptions
                  .filter((m) => m.id !== settings.primaryModel)
                  .map((m) => {
                    const selected = (settings.fallbackModels || []).includes(m.id);
                    const order = (settings.fallbackModels || []).indexOf(m.id);

                    return (
                      <li key={m.id} className={selected ? 'selected' : ''}>
                        <label className="fallback-check">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleFallback(m.id)}
                          />
                          <span>{m.displayName || m.id}</span>
                          {selected && <span className="order-badge">#{order + 1}</span>}
                        </label>
                        {selected && (
                          <span className="fallback-actions">
                            <button
                              type="button"
                              onClick={() => moveFallback(m.id, -1)}
                              disabled={order === 0}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFallback(m.id, 1)}
                              disabled={order === (settings.fallbackModels?.length ?? 0) - 1}
                            >
                              ↓
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </section>

        <section className="settings-section">
          <div className="section-row">
            <h2>{t('settings.sections.systemPrompt')}</h2>
            <button className="btn-secondary small" onClick={resetPrompt}>
              {t('settings.systemPrompt.reset')}
            </button>
          </div>

          <label className="field">
            <textarea
              rows={10}
              value={settings.systemPrompt}
              onChange={(e) => updateField('systemPrompt', e.target.value)}
              spellCheck={false}
            />
            <small>{t('settings.systemPrompt.hint')}</small>
          </label>
        </section>
      </div>

      <footer className="settings-footer">
        {status && <p className="settings-status">{status}</p>}
        <div className="settings-actions">
          <button className="btn-secondary" onClick={resetAll}>
            {t('settings.actions.resetAll')}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? t('settings.actions.saving') : t('settings.actions.save')}
          </button>
        </div>
      </footer>
    </div>
  );
}
