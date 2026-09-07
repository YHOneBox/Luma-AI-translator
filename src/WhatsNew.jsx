import { useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n';

function formatNotes(notes) {
  if (!notes) return [];
  return String(notes)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default function WhatsNew({ onBack }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState([]);
  const [appVersion, setAppVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    window.electronAPI?.getChangelog?.().then((data) => {
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
    });
    window.electronAPI?.getAppVersion?.().then((v) => {
      if (v) setAppVersion(v);
    });
  }, []);

  const checkUpdates = useCallback(async () => {
    setChecking(true);
    setStatus('');
    setUpdateInfo(null);
    try {
      const info = await window.electronAPI.checkForUpdates();
      if (info?.error) {
        throw new Error(info.error);
      }
      setUpdateInfo(info);
      setStatus(
        info.updateAvailable
          ? t('updates.available', { version: info.latestVersion })
          : t('updates.upToDate', { version: info.currentVersion })
      );
    } catch (err) {
      setStatus(err?.message || t('updates.checkFailed'));
    } finally {
      setChecking(false);
    }
  }, [t]);

  const openDownload = async () => {
    const url = updateInfo?.downloadUrl || updateInfo?.htmlUrl;
    if (!url) return;
    await window.electronAPI.openUpdatePage(url);
  };

  const openRelease = async () => {
    const url = updateInfo?.htmlUrl;
    if (!url) return;
    await window.electronAPI.openUpdatePage(url);
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button className="back-btn" onClick={onBack} aria-label={t('settings.back')}>
          ←
        </button>
        <h1>{t('whatsNew.title')}</h1>
      </header>

      <div className="settings-body">
        <section className="settings-section">
          <div className="section-row">
            <h2>{t('updates.title')}</h2>
            <button
              className="btn-secondary small"
              onClick={checkUpdates}
              disabled={checking}
            >
              {checking ? t('updates.checking') : t('updates.check')}
            </button>
          </div>
          <p className="settings-note">
            {t('updates.hint')}
            {appVersion ? ` ${t('updates.current', { version: appVersion })}` : ''}
          </p>
          {status ? <p className="settings-status">{status}</p> : null}

          {updateInfo?.updateAvailable ? (
            <div className="update-card">
              <p className="update-version">
                {t('updates.latest', { version: updateInfo.latestVersion })}
              </p>
              {formatNotes(updateInfo.releaseNotes).length > 0 ? (
                <ul className="changelog-items">
                  {formatNotes(updateInfo.releaseNotes).map((line) => (
                    <li key={line}>{line.replace(/^[-*]\s*/, '')}</li>
                  ))}
                </ul>
              ) : null}
              <div className="update-actions">
                <button className="btn-primary small" onClick={openDownload}>
                  {t('updates.download')}
                </button>
                <button className="btn-secondary small" onClick={openRelease}>
                  {t('updates.releasePage')}
                </button>
              </div>
              <p className="settings-note">{t('updates.portableHint')}</p>
            </div>
          ) : null}
        </section>

        <section className="settings-section">
          <h2>{t('whatsNew.changelog')}</h2>
          {entries.length === 0 ? (
            <p className="settings-note">{t('whatsNew.empty')}</p>
          ) : (
            <ul className="changelog-list">
              {entries.map((entry) => (
                <li key={entry.version} className="changelog-entry">
                  <div className="changelog-head">
                    <strong>v{entry.version}</strong>
                    {entry.date ? <span className="changelog-date">{entry.date}</span> : null}
                  </div>
                  {entry.title ? <p className="changelog-title">{entry.title}</p> : null}
                  <ul className="changelog-items">
                    {(entry.items || []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
