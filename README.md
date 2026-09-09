# Luma

A desktop translation app built with **Electron + React**. It runs in the background and lets you translate text from your screen using **Google Gemini** — no separate OCR step required. Press a global hotkey, and a popup near your cursor shows results in one of two layouts: a **dictionary-style view** for single words, or a **source + translation card view** for sentences and paragraphs.

**Author:** [Yi-Ho Chang](https://yhonebox.github.io/yh/)

---

## Table of Contents

- [How It Works (Overview)](#how-it-works-overview)
- [Translation Workflows](#translation-workflows)
  - [1. Full-Screen Translate](#1-full-screen-translate)
  - [2. Region Translate](#2-region-translate)
  - [3. Selection Translate](#3-selection-translate)
  - [4. Replace Selection](#4-replace-selection)
  - [5. Fix Grammar](#5-fix-grammar)
  - [6. Dictionary](#6-dictionary)
  - [7. Ask AI](#7-ask-ai)
- [Result Popup](#result-popup)
  - [Word Layout (single word)](#word-layout-single-word)
  - [Phrase Layout (sentence / paragraph)](#phrase-layout-sentence--paragraph)
- [Pronunciation & Audio](#pronunciation--audio)
- [Model Fallback](#model-fallback)
- [Background Mode & System Tray](#background-mode--system-tray)
- [Settings](#settings)
- [Hotkeys](#hotkeys)
- [Setup](#setup)
- [Download & Run (Portable)](#download--run-portable)
- [Releasing on GitHub](#releasing-on-github)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Gemini Output Schema](#gemini-output-schema)
- [Requirements](#requirements)
- [Troubleshooting](#troubleshooting)

---

## How It Works (Overview)

At a high level, every translation follows the same pipeline:

```
You press a hotkey
       ↓
Main process captures input (screenshot or selected text)
       ↓
Popup opens near your cursor (loading state)
       ↓
Gemini API returns structured JSON (translation, examples, context…)
       ↓
App picks layout: single word OR sentence/paragraph
       ↓
Enrichment: IPA + audio (word) OR TTS for both texts (phrase)
       ↓
Popup shows the final result
       ↓
You close the popup with the × button when done
```

The app has **two processes**:

| Process | Role |
|---------|------|
| **Main process** (`electron/`) | Hotkeys, screen capture, clipboard, Gemini API calls, pronunciation fetching, window management |
| **Renderer process** (`src/`) | React UI — main window, result popup, region selector, settings |

They communicate through **IPC** via a secure bridge in `electron/preload.js` (`window.electronAPI`).

---

## Translation Workflows

### 1. Full-Screen Translate

**Hotkey:** `Alt+T` (customizable in Settings)

**Step-by-step:**

1. You press `Alt+T` (or click **Translate Screen** in the app / tray menu).
2. The main window hides briefly so it does not appear in the capture.
3. A **popup window** opens near your cursor and shows *"Capturing screen…"*.
4. The main process takes a **full-screen screenshot** via Electron's `desktopCapturer`.
5. The screenshot is sent to **Gemini** as a PNG image with a structured JSON schema.
6. Gemini reads the visible text in the image and returns translation data.
7. If the result is a **single word**, IPA and pronunciation audio are loaded. If it is a **sentence or paragraph**, TTS audio is loaded for source and translation.
8. The popup updates with the full result.

```
Alt+T
    → hide main window
    → open popup (loading)
    → capture full screen
    → Gemini translateScreenshot()
    → resolveLayoutMode()
    → enrichWithPronunciation() OR enrichPhraseResult()
    → show result in popup
```

---

### 2. Region Translate

**Hotkey:** `Alt+C` (customizable)

**Step-by-step:**

1. You press `Alt+C` (or click **Select Region**).
2. A **full-screen overlay** appears with a crosshair cursor.
3. You **click and drag** to draw a rectangle around the text you want.
4. On release, the overlay closes and the same pipeline as full-screen translate runs — but only the **selected region** is captured and sent to Gemini.
5. Press `Esc` while dragging to cancel.

```
Alt+C
    → open region selector overlay
    → user draws rectangle
    → capture region only
    → Gemini translateScreenshot(region)
    → resolveLayoutMode()
    → enrichWithPronunciation() OR enrichPhraseResult()
    → show result in popup
```

---

### 3. Selection Translate

**Hotkey:** `Alt+X` (customizable)

**Step-by-step:**

1. **Highlight text** in any app (browser, PDF, editor, etc.).
2. Press `Alt+X` (or click **Translate Selection**).
3. The app **hides its windows**, simulates `Ctrl+C` to copy your selection, and reads the clipboard.
4. It verifies the clipboard text actually changed (retries copy if needed).
5. The selected text is sent to Gemini as plain text (no screenshot).
6. Pronunciation or phrase audio is loaded based on layout mode.
7. The popup shows the final result in the appropriate layout.

```
Highlight text → Alt+X
    → hide app windows
    → simulate Ctrl+C, read clipboard
    → Gemini translateText(text)
    → resolveLayoutMode()
    → enrichWithPronunciation() OR enrichPhraseResult()
    → show result in popup
```

> **Tip:** Make sure text is selected before pressing the hotkey. If nothing is selected, the app shows an error in the popup.

---

### 4. Replace Selection

**Hotkey:** `Alt+R` (customizable)

**Step-by-step:**

1. **Highlight text** in any app.
2. Press `Alt+R` (or click **Replace Selection**).
3. Luma copies the selection, translates it into the **Replace language** from Settings (default: English), and pastes the translation back over the selection.
4. A bottom status bar shows progress, then **Replace complete** (or an error if the text could not be replaced). No result popup is shown.

Set the destination language under **Settings → Basic → Replace language**.

---

### 5. Fix Grammar

**Hotkey:** `Alt+G` (customizable)

**Step-by-step:**

1. **Highlight text** in any app (email, chat, docs, etc.).
2. Press `Alt+G` (or click **Fix Grammar**).
3. Luma detects the language, checks grammar/spelling/fluency in that same language, then pastes the corrected text over your selection.
4. The status bar shows **Grammar fix complete**, **No grammar changes needed**, or an error if correction/replace failed.

This works for **any language** (and mixed-language text). It does **not** translate — it only improves correctness in the original language(s).

---

### 6. Dictionary

**Hotkey:** `Alt+D` (customizable)

**Step-by-step:**

1. Press `Alt+D` (or click **Dictionary** in the main window / tray).
2. A popup opens **near your cursor**. Type a word or sentence you want to look up.
3. Press **Enter** (or click **Look up**).
4. Results use the same layouts as selection translate: **word** detail view for a single word, or **phrase** cards for longer text.

Press `Esc` or the × button to close the dictionary popup.

---

### 7. Ask AI

**Hotkey:** `Alt+A` (customizable)

**Step-by-step:**

1. Press `Alt+A` (or click **Ask AI** in the main window / tray).
2. A chat popup opens near your cursor.
3. Type a question and press **Enter** (Shift+Enter for a new line).
4. Gemini replies in a multi-turn chat you can continue or **Clear**.

Use **What's New** on the home screen to see the changelog and **Check for updates** against GitHub Releases. For portable builds, download the new file, quit Luma, then run the new executable — settings stay in `Luma-Data`.

---

## Result Popup

The popup is a frameless, dark-themed window that appears **near your cursor**. It automatically chooses one of two layouts based on how much text was captured or selected.

### Layout selection

The main process calls `resolveLayoutMode()` in `electron/pronunciation.js`:

| Condition | Layout | UI |
|-----------|--------|-----|
| Source text has **more than one word** | `phrase` | Two stacked cards (source + translation) |
| Source text is a **single word** | `word` | Dictionary-style detail view |

**Source text** is resolved from (in order):

1. `sourceText` — clipboard selection (selection translate)
2. `source_text` — returned by Gemini (screen / region translate)

### Word Layout (single word)

Used when you translate one word from a screenshot or selection.

| Section | Content |
|---------|---------|
| **Word header** | English headword, IPA phonetic, speaker button |
| **Part of speech + translation** | e.g. `n. 演算法` |
| **Example sentence** | Source-language example with the target word highlighted in pink |
| **Example translation** | Translation of the example sentence |
| **Context card** | General meaning + **"In this context"** usage notes for your specific capture |
| **Model badge** | Which Gemini model produced the result |

### Phrase Layout (sentence / paragraph)

Used when you translate a sentence, clause, or paragraph.

| Card | Content |
|------|---------|
| **Top card** | Original source text |
| **Bottom card** | Translation (bold) |

Each card has a footer with:

- **Speaker** — play TTS audio (preloaded in main process)
- **Copy** — copy that card's text to clipboard
- **Show all** (top card only) — expand truncated long source text

### Popup behavior

- **Move** — drag the top title bar
- **Resize** — drag any window edge (minimum 340×380)
- **Close** — click the **×** button (top right only; clicking outside does not close)
- **Copy / play audio** — use icons in the card footers (layout-dependent)

---

## Pronunciation & Audio

Enrichment runs in the **main process** (avoids CORS) and completes **before** the result is shown.

### Single word (`layoutMode: word`)

Triggered by `enrichWithPronunciation()`.

**Lookup word** is resolved from (in order):

1. `base_word` from Gemini
2. `sourceText` / `source_text`
3. First English word in the example sentence

**IPA sources** (in order):

1. `phonetic_ipa` from Gemini
2. [Wiktionary API](https://en.wiktionary.org/)

**Audio sources** (in order):

1. Dictionary API (if available)
2. Google Translate TTS → delivered as base64 `audioDataUrl`

Popup title bar shows *"Loading pronunciation…"* while this runs.

### Sentence / paragraph (`layoutMode: phrase`)

Triggered by `enrichPhraseResult()`.

| Field | Description |
|-------|-------------|
| `sourceAudioDataUrl` | TTS for source text (English, `tl=en`) |
| `translationAudioDataUrl` | TTS for translation (language from Settings → Target language) |

Google TTS is capped at 200 characters per request. Popup title bar shows *"Loading audio…"* while this runs.

---

## Model Fallback

Translation uses a **model chain** configured in Settings:

```
Primary model  →  Fallback 1  →  Fallback 2  →  …
```

**Default chain:**

| Role | Model |
|------|-------|
| Primary | `gemini-3.5-flash-lite` |
| Fallback 1 | `gemini-3.6-flash` |
| Fallback 2 | `gemini-3.5-flash` |

**Timeout behavior:** Each model gets **10 seconds**. If it does not respond in time, the app automatically tries the next model and updates the popup message (e.g. *"Timed out on gemini-3.5-flash-lite, trying gemini-3.6-flash…"*).

If all models fail, the popup shows an error with details from each attempt.

---

## Background Mode & System Tray

Luma is designed to stay available while you work in other apps.

| Action | What happens |
|--------|--------------|
| **Launch app** | Main window opens; app icon appears in the taskbar and system tray |
| **Close main window (×)** | Window hides — app **keeps running** in the tray; hotkeys still work |
| **Tray double-click** or **Open Luma** | Brings the main window back |
| **Tray → Quit** | Fully exits the app |

Global hotkeys are registered at startup and re-registered whenever you save new hotkeys in Settings.

---

## Settings

Open **Settings** from the gear icon on the main window.

| Setting | Description |
|---------|-------------|
| **API Keys** | Add, remove, and switch between Gemini API keys (stored locally) |
| **App language** | Interface language (menus, buttons, settings). Chosen on first launch; changeable anytime |
| **Start with computer** | Launch Luma in the tray when you sign in, so hotkeys are ready |
| **Target language** | Language Gemini translates into (default: Chinese (Traditional)) |
| **Replace language** | Language used when replacing selected text in place (default: English) |
| **Primary model** | First Gemini model to try |
| **Fallback models** | Ordered list of backup models; use **Scan models** to discover available models for your API key |
| **System prompt** | Custom instructions sent to Gemini; `{targetLanguage}` is replaced automatically |
| **Hotkeys** | Customize shortcuts for screen, region, and selection translate |

Settings are saved to:

```
%APPDATA%/Luma/settings.json   (Windows)
~/Library/Application Support/Luma/settings.json   (macOS)
~/.config/Luma/settings.json   (Linux)
```

**Hotkey recording:** Click **Set key** in Settings, then press your desired key combination. Press `Esc` to cancel. Each hotkey must include at least one modifier (`Ctrl`, `Alt`, or `Shift`) and must be unique across all actions.

### API Keys

Open **Settings → API Keys** to manage your Gemini keys in the app.

| Action | How |
|--------|-----|
| **Add a key** | Enter an optional label + API key → **Add API Key** |
| **Switch active key** | Select the radio button next to the key you want to use |
| **Remove a key** | Click **Remove** on that entry |

**Priority order** the app uses to find a key:

1. **Active saved key** in Settings (recommended for daily use)
2. **First saved key** if no active key is set
3. **`.env` file** (`GEMINI_API_KEY=...`) as a developer fallback

Keys are saved in your local settings file (`settings.json` under the app user data folder). They are **masked in the UI** (only the first/last few characters are shown) and are **never committed to Git** if you follow the release steps below.

Get a free key from [Google AI Studio](https://aistudio.google.com/apikey).

> **Security:** Do not commit `.env`, `settings.json`, or screenshots of your API keys to GitHub.

---

## Hotkeys

| Shortcut | Action |
|----------|--------|
| `Alt+T` | Capture **full screen** and translate |
| `Alt+C` | **Select a region** and translate |
| `Alt+X` | Translate **highlighted text** (selection lookup) |
| `Alt+R` | **Replace** highlighted text with a translation |
| `Alt+G` | **Fix grammar** of highlighted text (any language) and replace it |
| `Alt+D` | Open **Dictionary** near the cursor to type a word/sentence and look it up |
| `Alt+A` | Open **Ask AI** chat near the cursor |
| `Esc` | Cancel region selection / close dictionary or Ask AI popup |

All hotkeys can be changed in **Settings**.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Gemini API key

**Option A — In the app (recommended)**

1. Run the app (`npm run dev`).
2. Open **Settings** (gear icon) → **API Keys**.
3. Paste your key from [Google AI Studio](https://aistudio.google.com/apikey).
4. Click **Add API Key**.

**Option B — `.env` file (developers)**

```bash
copy .env.example .env
```

Edit `.env`:

```
GEMINI_API_KEY=your_actual_api_key_here
```

The app uses saved Settings keys first; `.env` is only a fallback.

The app uses saved Settings keys first; `.env` is only a fallback for developers.

---

## Download & Run (Portable)

End users can run Luma **without installing Node.js** — download the portable build from GitHub Releases.

### For users (after you publish a release)

1. Open your repo on GitHub → **Releases**.
2. Download the build for your platform from **Assets**:

| Platform | File | How to run |
|----------|------|------------|
| **Windows** | `Luma-*-win-Portable.exe` | Double-click (no install) |
| **macOS** | `Luma-*-mac-*.dmg` or `.zip` | Open DMG, drag to Applications; or unzip |
| **Linux** | `Luma-*-linux-*.AppImage` or `.zip` | `chmod +x` AppImage, then run; or unzip |

3. Run the app (see table above).
4. On first launch, open **Settings → API Keys** and add your [Gemini API key](https://aistudio.google.com/apikey).
5. Use hotkeys or the main window to translate.

> **Windows SmartScreen:** Unsigned apps may show a warning. Click **More info** → **Run anyway**. This is normal for open-source apps without a code-signing certificate.

### What gets stored on disk?

The portable app is designed to stay **self-contained** — it does **not** install, does **not** write to the registry, and does **not** use `%APPDATA%`.

| Location | Stored? | What's in it |
|----------|---------|--------------|
| **`Luma-Data/`** (next to the `.exe`) | Only if you change settings or save an API key | `settings.json` (hotkeys, models, API keys) |
| **`Luma-Data/cache/`** | Temporary | Cleared automatically when you quit the app |
| **Windows AppData** | No | — |
| **Registry** | No | — |
| **Translation history** | No | Nothing is logged locally |
| **Network** | Yes (required) | Gemini API, pronunciation/TTS lookups only when you translate |

**To remove everything:** quit the app and delete the `Luma-Data` folder next to the portable `.exe`.

**Optional:** Place a `.env` file next to the `.exe` with `GEMINI_API_KEY=...` instead of saving keys in Settings (you manage that file yourself).

### For developers — build portable locally

```bash
npm install
npm run dist:portable
```

Output:

```
release/Luma-1.0.10-win-Portable.exe
```

Other build commands:

| Command | Output |
|---------|--------|
| `npm run dist:portable` | Windows portable `.exe` |
| `npm run dist:mac` | macOS `.dmg` + `.zip` |
| `npm run dist:linux` | Linux `.AppImage` + `.zip` |
| `npm run dist:win` | Windows portable `.exe` + `.zip` |
| `npm run dist` | Platform-default packages (portable on Windows) |
| `npm run pack` | Unpacked folder in `release/win-unpacked/` (for testing) |

---

### 3. Run from source (developers)

```bash
npm run dev
```

**Production (from source):**

```bash
npm start
```

---

## Setup (developers)

### Run from source

**Development** (Vite dev server + Electron with hot reload):

## Releasing on GitHub

Follow these steps to publish **v1.0.0** (or any first release) safely.

### Before you push

1. **Confirm secrets are ignored** — this repo's `.gitignore` already excludes:
   - `.env` (API keys)
   - `node_modules/`, `dist/`, `release/`

2. **Never commit** your Gemini API key, `.env`, or `%APPDATA%/Luma/settings.json`.

3. **Quick check** (in the project folder):

```bash
git status
```

Make sure `.env` does not appear under "Changes to be committed".

### Step 1 — Create a GitHub repository

1. Go to [github.com/new](https://github.com/new).
2. Name it e.g. `Luma`.
3. Leave it **Public** or **Private** (your choice).
4. **Do not** initialize with a README if you already have one locally.
5. Click **Create repository**.

### Step 2 — Push your code

In PowerShell, from your project folder:

```bash
git init
git add .
git commit -m "Initial release: Luma v1.0.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/Luma.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

### Step 3 — Tag the version

```bash
git tag -a v1.0.0 -m "Luma v1.0.0"
git push origin v1.0.0
```

Tags mark official releases (e.g. `v1.0.0`, `v1.1.0`).

### Step 4 — Create a GitHub Release (automated build)

When you push a version tag, GitHub Actions builds for **Windows, macOS, and Linux** and attaches all files to the release automatically.

```bash
git tag -a v1.0.0 -m "Luma v1.0.0"
git push origin v1.0.0
```

1. Wait for the **Build Release** workflow to finish (Actions tab — three build jobs + publish).
2. Open **Releases** — assets should include `.exe`, `.dmg`, `.AppImage`, and `.zip` files.
3. Or create a release manually and attach `release/Luma-*-win-Portable.exe` from a local `npm run dist:portable` build.

**Release description** — example:

```markdown
## Luma v1.0.0

First public release of the desktop translation app.

### Features
- Screen, region, selection, and replace translation via Gemini
- Dictionary-style popup for single words
- Two-card layout for sentences and paragraphs
- IPA + pronunciation audio
- Customizable hotkeys and model fallbacks
- API key management in Settings
- In-place replace selection into a configurable language

### Install (download — recommended)
1. Download the file for your OS from Assets below (`.exe` / `.dmg` / `.AppImage`)
2. Run the app (see platform table in Download & Run section)
3. Settings → API Keys → add your Gemini key
4. Press `Alt+T` / `C` / `X` / `R` to translate or replace

### Install (from source)
1. Clone the repo
2. `npm install`
3. Add API key in Settings → API Keys
4. `npm run dev` or `npm start`
```

5. Click **Publish release** (if drafting manually).

### Step 5 — What users need

**Portable download (recommended):**

1. Download the build for your OS from Releases
2. Run the app
3. Add a Gemini API key in **Settings → API Keys**

**From source:**

1. Install [Node.js 18+](https://nodejs.org/)
2. Run `npm install`
3. Add a Gemini API key in **Settings → API Keys**
4. Run `npm run dev` or `npm start`

### Optional next steps

| Goal | Action |
|------|--------|
| **License** | Add a `LICENSE` file (MIT is already in `package.json`) |
| **CI builds** | Add GitHub Actions to run `npm run build` on push |
| **Installers** | Windows, macOS, and Linux builds on every tag push; see `.github/workflows/release.yml` |
| **Changelog** | Keep release notes in GitHub Releases or a `CHANGELOG.md` |

---

## Project Structure

```
Luma/
├── electron/                  # Main process (Node.js)
│   ├── main.js                # App entry: hotkeys, windows, IPC, tray
│   ├── preload.js             # Secure IPC bridge (window.electronAPI)
│   ├── gemini.js              # Gemini API + structured JSON schema + model fallback
│   ├── capture.js             # Screen capture via desktopCapturer
│   ├── selection.js           # Clipboard-based text selection (simulates Ctrl+C)
│   ├── pronunciation.js       # Layout mode, IPA, word audio, phrase TTS
│   ├── settings.js            # Settings load/save/migrate
│   ├── api-keys.js            # API key storage, masking, active key resolution
│   ├── models.js              # Gemini model list scanner
│   ├── hotkey-recorder.js     # Hotkey capture in Settings
│   └── hotkey-utils.js        # Hotkey validation and formatting
├── src/                       # Renderer process (React + Vite)
│   ├── main.jsx / MainApp.jsx # Main window UI
│   ├── App.jsx                # Translation result popup UI (shared Word/Phrase views)
│   ├── dictionary.html/.jsx   # Dictionary lookup popup near cursor
│   ├── RegionSelector.jsx     # Region selection overlay
│   ├── Settings.jsx           # Settings page
│   ├── HotkeyInput.jsx        # Hotkey picker component
│   └── styles.css             # Shared styles
├── assets/logo.png            # App icon (taskbar, tray, installer)
├── .env.example               # API key template
├── package.json
└── vite.config.js
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MAIN PROCESS (electron/)                 │
│                                                              │
│  globalShortcut ──→ startTranslation / startSelection       │
│         │                                                    │
│         ├── capture.js ──→ PNG screenshot                   │
│         ├── selection.js ──→ clipboard text                   │
│         │                                                    │
│         ├── gemini.js ──→ Gemini API (structured JSON)      │
│         │       └── 10s timeout → try next model            │
│         │                                                    │
│         ├── pronunciation.js                                │
│         │       ├── resolveLayoutMode() → word | phrase     │
│         │       ├── enrichWithPronunciation() → IPA + audio │
│         │       └── enrichPhraseResult() → phrase TTS       │
│         │                                                    │
│         └── IPC send ──→ popup window                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ preload.js (contextBridge)
┌──────────────────────────▼──────────────────────────────────┐
│                   RENDERER PROCESS (src/)                    │
│                                                              │
│  MainApp.jsx ── home screen + settings entry                 │
│  App.jsx ────── result popup                                 │
│       ├── WordResult ── single word (IPA, examples, context)│
│       └── PhraseResult ── source + translation cards         │
│  RegionSelector.jsx ── drag-to-select overlay                 │
│  Settings.jsx ── models, hotkeys, prompt, language           │
└─────────────────────────────────────────────────────────────┘
```

**IPC channels (main → popup):**

| Channel | Purpose |
|---------|---------|
| `translation:loading` | Update loading message |
| `translation:result` | Show final result (`layoutMode: word` or `phrase`) |
| `translation:error` | Show error message |

**IPC channels (renderer → main):**

| Channel | Purpose |
|---------|---------|
| `translate:screen` | Trigger full-screen translate |
| `translate:region` | Open region selector |
| `translate:selection` | Trigger selection translate |
| `translate:replace` | Translate selection and paste it back in place |
| `translate:grammar` | Correct grammar of selection and paste it back |
| `dictionary:show` | Open dictionary popup near the cursor |
| `dictionary:close` | Close dictionary popup |
| `dictionary:lookup` | Look up typed text (returns enriched word/phrase result) |
| `popup:close` | Close result popup |
| `settings:save` | Save settings and re-register hotkeys |
| `hotkey:record` | Record a new hotkey in Settings |
| `apiKeys:add` | Add a Gemini API key |
| `apiKeys:remove` | Remove a saved API key |
| `apiKeys:setActive` | Set the active API key |

---

## Gemini Output Schema

Gemini returns JSON matching this schema (defined in `electron/gemini.js`):

```json
{
  "translation": "演算法",
  "source_text": "algorithm",
  "example_sentence": "The algorithm helped solve the complex problem.",
  "example_translation": "這個演算法幫助解決了複雜的問題。",
  "context_explanation": "General meaning and typical usage…",
  "usage_in_context": "How this word is used in YOUR specific screenshot or selection…",
  "part_of_speech": "n.",
  "phonetic_ipa": "/ˈælɡəɹɪðəm/",
  "base_word": "algorithm"
}
```

For **selection translate**, `source_text` is also set from the clipboard in the main process (`sourceText`).

**Result payload sent to the popup** may include additional enriched fields:

| Field | When | Description |
|-------|------|-------------|
| `layoutMode` | Always | `"word"` or `"phrase"` |
| `phonetic` | Word layout | Normalized IPA string |
| `audioDataUrl` | Word layout | Base64 audio for pronunciation |
| `sourceAudioDataUrl` | Phrase layout | Base64 TTS for source text |
| `translationAudioDataUrl` | Phrase layout | Base64 TTS for translation |
| `modelUsed` | Always | Gemini model that succeeded |

The Cambridge Dictionary URL is built automatically:

```
https://dictionary.cambridge.org/dictionary/english/{base_word}
```

---

## Requirements

- **Node.js** 18+
- **Windows**, macOS, or Linux
- A **Gemini API key** with access to flash models (e.g. `gemini-3.5-flash-lite`)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"GEMINI_API_KEY is not set" / No API key** | Open **Settings → API Keys** and add a key, or set `GEMINI_API_KEY` in `.env` |
| **Hotkey not working** | Another app may use the same shortcut — change it in Settings, or quit conflicting apps |
| **Translation stuck / slow** | Add fallback models in Settings; each model times out after 10 seconds and switches automatically |
| **Selection translate copies wrong text** | Make sure text is highlighted before pressing the hotkey; the app copies selection before opening the popup |
| **No IPA or pronunciation** | Only on **word layout** for English headwords; phrase layout uses TTS instead |
| **Wrong popup layout** | One word → word layout; multiple words → phrase layout; depends on `source_text` / selection |
| **Phrase audio missing** | TTS is limited to 480 chars; very long text may not produce audio |
| **Where is my data stored?** | Portable builds: `Luma-Data/` next to the `.exe` only — delete that folder to wipe all local data |
| **Blank screenshot** | Grant screen recording permission (macOS: System Settings → Privacy → Screen Recording) |
| **Model scan shows no models** | Check your API key; click **Scan models** again in Settings |

---

## License

MIT
