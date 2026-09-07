const MODIFIER_DISPLAY = {
  CommandOrControl: 'Ctrl',
  Control: 'Ctrl',
  Command: 'Cmd',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Win',
};

const KEY_DISPLAY = {
  Space: 'Space',
  Plus: '+',
  Minus: '-',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

function normalizeKey(key) {
  if (!key) return '';

  if (key === ' ') return 'Space';
  if (key.startsWith('Arrow')) return key.replace('Arrow', '');
  if (key === 'Escape') return 'Esc';
  if (key.length === 1) return key.toUpperCase();

  return key;
}

/**
 * Convert a keyboard event into an Electron accelerator string.
 * @param {KeyboardEvent} event
 * @returns {string|null}
 */
function eventToAccelerator(event) {
  const parts = [];

  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = normalizeKey(event.key);
  if (['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(key)) {
    return null;
  }

  if (parts.length === 0) return null;

  parts.push(key);
  return parts.join('+');
}

/**
 * Convert an Electron before-input-event payload into an accelerator string.
 * @param {{ key: string, control: boolean, meta: boolean, shift: boolean, alt: boolean }} input
 * @returns {string|null}
 */
function inputToAccelerator(input) {
  const parts = [];

  if (input.control || input.meta) parts.push('CommandOrControl');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');

  const key = normalizeKey(input.key);
  if (['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(key)) {
    return null;
  }

  if (parts.length === 0) return null;

  parts.push(key);
  return parts.join('+');
}

function formatHotkeyDisplay(accelerator) {
  if (!accelerator) return 'Not set';

  return accelerator
    .split('+')
    .map((part) => MODIFIER_DISPLAY[part] || KEY_DISPLAY[part] || part)
    .join(' + ');
}

function validateHotkeys(settings) {
  const entries = [
    { name: 'Translate Screen', value: settings.hotkeyScreen },
    { name: 'Select Region', value: settings.hotkeyRegion },
    { name: 'Translate Selection', value: settings.hotkeySelection },
    { name: 'Replace Selection', value: settings.hotkeyReplace },
    { name: 'Fix Grammar', value: settings.hotkeyGrammar },
    { name: 'Dictionary', value: settings.hotkeyDictionary },
    { name: 'Ask AI', value: settings.hotkeyAsk },
  ];

  const active = entries.filter((e) => e.value);
  const seen = new Set();

  for (const { name, value } of active) {
    if (!value.includes('+')) {
      throw new Error(`${name} hotkey must include at least one modifier (Ctrl, Alt, Shift).`);
    }

    if (seen.has(value)) {
      throw new Error('Each hotkey must be unique. Two actions share the same shortcut.');
    }
    seen.add(value);
  }

  return true;
}

module.exports = {
  eventToAccelerator,
  inputToAccelerator,
  formatHotkeyDisplay,
  validateHotkeys,
  normalizeKey,
};
