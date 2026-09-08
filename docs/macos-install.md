# macOS Installation Guide (Apple Silicon)

Tested target: MacBook Air M5, macOS 15+. Everything runs natively on Apple Silicon — no Rosetta, no Ollama, no local LLM downloads.

## Option A — one-click installer (recommended)

```bash
git clone https://github.com/thanhsu/learning-harness.git
cd learning-harness
```

Then **double-click `scripts/install-mac.command` in Finder** (or run
`bash scripts/install-mac.command`). It installs, in order: Homebrew → Node 20
→ Python 3 → BlackHole (Zoom audio capture) → npm packages → the Whisper
bridge's Python venv → creates `.env` and asks for your free Gemini key →
starts the server and opens <http://localhost:3456>. Every step is skipped if
already satisfied, so it doubles as a repair tool.

> If macOS blocks the double-click ("unidentified developer" — happens when the
> repo was downloaded as a ZIP), right-click the file → Open, or run it with
> `bash scripts/install-mac.command`.

For daily use afterwards, double-click `scripts/start-mac.command`.

## Option B — manual install

## 1. Install Node.js 20+

Using Homebrew:

```bash
# Install Homebrew if you don't have it: https://brew.sh
brew install node@20
brew link node@20
node --version   # should print v20.x or newer
```

Or with nvm if you prefer per-project Node versions:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use 20
```

## 2. Clone and install

```bash
git clone https://github.com/<your-username>/learning-harness.git
cd learning-harness
npm install
```

`better-sqlite3` ships prebuilt Apple Silicon binaries, so `npm install` should not need Xcode. If it ever falls back to compiling from source, install the command-line tools once:

```bash
xcode-select --install
```

## 3. Configure

```bash
cp .env.example .env
open -e .env
```

- Get a **free** Gemini API key at <https://aistudio.google.com/apikey> (Google AI Studio, no billing account required) and paste it into `GEMINI_API_KEY`.
- Leave `PAID_AI_DISABLED=true` and `MAX_DAILY_CALLS=20` — this is the zero-cost guard.
- You can also run with **no key at all**: notes are still generated in offline fallback mode (extractive summary, no quiz/flashcards).

## 4. Run

```bash
npm start
```

Then open <http://localhost:3456>. By default the app:

- watches `~/Documents/Zoom` for `.txt` / `.vtt` / `.srt` / `.md` transcripts,
- writes Markdown notes to `~/LearningVault`,
- keeps its own state in `~/.learning-harness`.

Quick smoke test:

```bash
cp samples/sample.vtt ~/Documents/Zoom/
# within a few seconds a note appears in ~/LearningVault and in the dashboard
```

## 5. Run tests

```bash
npm test
```

## 6. Optional: start automatically at login (launchd)

Create `~/Library/LaunchAgents/com.local.learning-harness.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.local.learning-harness</string>
  <key>WorkingDirectory</key><string>/Users/YOUR_USER/learning-harness</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/npm</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/learning-harness.log</string>
  <key>StandardErrorPath</key><string>/tmp/learning-harness.err</string>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/com.local.learning-harness.plist
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `EADDRINUSE: port 3456` | Another instance is running, or change `PORT` in `.env`. |
| Notes say "offline fallback" | No `GEMINI_API_KEY` set, the daily quota was reached, or the API errored — the exact reason is printed in the note header and server log. |
| `429 QUOTA_EXCEEDED` | You hit `MAX_DAILY_CALLS`. Raise it in `.env` or wait until tomorrow. |
| Zoom files not picked up | Confirm the transcript really lands in `WATCH_DIR` (Zoom settings vary) and has a supported extension. |
