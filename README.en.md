# HaE-Lite 🕵️‍♂️

> Lightweight Chrome extension: real-time sensitive data highlighting in DevTools, with custom regex and multi-rule management.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/intro/platform-vision/)
[![License](https://img.shields.io/badge/License-MIT-orange)](LICENSE)

English | [中文](README.md)

## 📖 Description

HaE-Lite (Highlighter & Extractor Lite) is a lightweight data extraction and highlighting tool based on Chrome DevTools. It leverages the Chrome Debugger Protocol to capture network requests and response bodies in real time, and matches sensitive information through user-defined regex rules. Internally HaE-Lite uses a simplified rule field set for efficient matching, while remaining compatible with the original HaE YAML rule files (bulk YAML import/export with automatic field mapping). This helps security testers, penetration testers, and developers quickly discover sensitive data during debugging.

### Key Features

- **Zero-dependency runtime**: Pure front-end implementation, no extra proxy tools required—just open DevTools and go.
- **Real-time capture**: Automatically attaches to HTTP(S) tabs via Chrome Debugger Protocol and streams requests/responses live.
- **Rule management**: Bulk YAML import/export and in-panel rule editing; customize regex, severity, scope, sensitivity, and enable state.
- **Global toggle**: One-click enable/disable in the top-right corner; automatically attaches/detaches all debugger sessions.
- **Results sidebar**: Severity-coded matches with one-click copy, export, and jump-to-source for easy analysis and reporting.
- **Lightweight & efficient**: Manifest V3 architecture, event-driven, low resource usage.

## 🚀 Quick Start

### Installation

1. **Clone the repo**

   ```bash
   git clone https://github.com/kingjly/HaE-Lite.git
   cd HaE-Lite
   ```

2. **Load the extension**

   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top-right corner
   - Click "Load unpacked" and select the `HaE-Lite` folder
   - The extension icon appears in the toolbar—done ✅

3. **Open the panel**

   - Visit any webpage, press `F12` or `Ctrl+Shift+I` to open DevTools
   - Click the **HaE-Lite** tab at the top to start using it

### Usage Example

- **Capture demo**: Open any website and you’ll see requests listed in the HaE-Lite panel.
- **Rule demo**: Built-in rules cover ID numbers, phone numbers, emails, JWTs, API keys, etc.
- **Highlighting**: Matches are color-highlighted for quick spotting.

## 📦 Rule Management

### Built-in Rules

The project includes a sample default rule set in `Rules.yml` covering common sensitive data.
You can import it via the panel. Built-in defaults in code are present but disabled by default; enable rules individually as needed.

### Custom Rules

In the panel’s "Rules" sub-tab you can:

- Add new rules: enter name, regex/pattern, category, severity, scope, and whether it’s sensitive
- Enable/disable: toggle switch, instant effect
- Delete rules: click the trash icon
- Import/export: bulk YAML import/export

### Rule Fields

| Field       | Type    | Description                                                  |
| ----------- | ------- | ------------------------------------------------------------ |
| `id`        | string  | Unique identifier                                            |
| `name`      | string  | Display name                                                 |
| `pattern`   | string  | Regular expression for matching (supports inline flags like `(?i)`) |
| `category`  | string  | Rule category (e.g., Auth, Key, Secret)                      |
| `severity`  | string  | Severity level (`low`/`medium`/`high`)                       |
| `scope`     | string  | Match scope (`any`, `request header`, `request body`, `response header`, `response body`, `url`, etc.) |
| `sensitive` | boolean | Mark as sensitive (emphasized in list)                       |
| `loaded`    | boolean | Whether the rule is enabled by default                       |

Compatibility with original HaE YAML:

- Supports importing/exporting original fields with automatic mapping:
  - `f_regex` → `pattern`
  - `color` → `severity` (red/orange → high; yellow/green → medium; others → low)
  - `scope` is normalized to the simplified scope enums
  - `loaded` controls enabled state
- For compatibility, fields like `s_regex`, `format`, and `engine` are preserved when importing/exporting, but the current matcher does not use them.

Example (original HaE YAML):

```yaml
- name: "API Key"
  f_regex: "(?i)(api[_-]?key|apikey)\s*[:=]\s*['\"]?([a-z0-9_\-]{16,})['\"]?"
  color: "red"
  loaded: true
  scope: "response body"
  engine: "regex"
  s_regex: ""
  format: ""
```

## ⚙️ Settings

In the panel’s "Settings" sub-tab you can configure:

- **Global toggle**: master switch in the top-right corner to enable/disable all capturing
- **Default rules**: built-in defaults are disabled by default; enable rules individually in the list
- **Domain whitelist**: capture only specified domains (supports wildcards)
- **Domain blacklist**: exclude specified domains
- **Extension filter**: skip static assets (e.g., `.js` `.css` `.jpg`)

## 💾 Data Storage

- Uses local IndexedDB to store rules and history
- Automatically cleans records older than 7 days to save space
- Manual export of history and YAML import/export of rules is supported
- No cloud sync: does not sync to your Google account or any server

## 🔧 Development

### Project Structure

```
HaE-Lite/
├── manifest.json          # Extension manifest
├── background.js          # Background script (debugger capture)
├── devtools/              # DevTools panel
│   ├── devtools.html/js   # Panel entry
│   ├── panel.html/js/css  # Main UI
│   └── styles.css         # Styles
├── shared/                # Shared modules
│   ├── storage.js         # Storage wrapper
│   ├── ruleEngine.js      # Rule engine
│   ├── rules.js           # Default rules
│   └── utils.js           # Utilities
├── scripts/               # Development scripts
│   ├── quality-check.ps1  # Code quality check
│   └── dev-http.ps1       # Local preview
├── docs/                  # Documentation
└── Rules.yml              # Default rule file
```

### Local Development

1. **Install dependencies** (dev tools only)

   ```bash
   npm install
   ```

2. **Start local preview**

   ```powershell
   # PowerShell
   .\scripts\dev-http.ps1
   # or manually
   npx http-server -p 5500
   ```

   Visit http://127.0.0.1:5500/devtools/panel.html to preview the panel UI

3. **Code quality check**

   ```powershell
   .\scripts\quality-check.ps1
   ```

### Extension Permissions

| Permission | Purpose                                      |
| ---------- | -------------------------------------------- |
| `debugger` | Capture network requests and response bodies |
| `storage`  | Save rules and history                       |
| `tabs`     | Monitor tab changes and auto-attach debugger |

## 📋 Known Limitations

- Only HTTP/HTTPS protocols are supported; `chrome://`, `file://`, etc. cannot be captured
- In some scenarios, the debugger may not obtain the complete response body (depends on page and browser state)
- Only one extension can attach the debugger at a time; if another extension occupies it, HaE-Lite won’t work
- Large numbers of rules or high-frequency matching may impact performance—please configure rules reasonably

## 🔐 Privacy Statement

- All data is stored locally in IndexedDB; nothing is uploaded to any server
- No personal information, browsing history, or other private data is collected
- Event-driven background service worker (MV3): when the global toggle is enabled, it attaches to HTTP(S) tabs to capture traffic; it is not a persistent background page
- Open source and transparent—code is auditable; Issues and PRs are welcome

## 🤝 Contributing

Issues and Pull Requests are welcome!

- Issue reports: please describe the problem, reproduction steps, and expected behavior
- PR submissions: ensure code passes quality checks and add necessary comments
- New rules: contributions of common sensitive-data regexes are welcome—please include test cases

## 📄 License

MIT License [LICENSE](https://github.com/kingjly/HaE-Lite/blob/main/LICENSE)

---

If this project helps you, please give it a ⭐ Star!
