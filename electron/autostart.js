const path = require('path');
const { app } = require('electron');

const HIDDEN_FLAG = '--hidden';

function getAutostartArgs() {
  if (app.isPackaged) {
    return [HIDDEN_FLAG];
  }

  const appEntry = path.resolve(process.argv[1] || app.getAppPath());
  return [appEntry, HIDDEN_FLAG];
}

function applyLaunchAtStartup(enabled) {
  const openAtLogin = Boolean(enabled);

  try {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: true,
      path: process.execPath,
      args: getAutostartArgs(),
    });
  } catch (err) {
    console.warn('Could not update launch-at-startup:', err.message);
  }
}

function shouldStartHidden() {
  if (process.argv.includes(HIDDEN_FLAG)) return true;

  try {
    const login = app.getLoginItemSettings({
      path: process.execPath,
      args: getAutostartArgs(),
    });
    return Boolean(login.wasOpenedAtLogin || login.wasOpenedAsHidden);
  } catch {
    return false;
  }
}

module.exports = {
  applyLaunchAtStartup,
  shouldStartHidden,
};
