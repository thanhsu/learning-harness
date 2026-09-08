# learning-harness

A lightweight, local-first AI learning harness for online classes and Zoom
meetings. It ingests transcripts (files or live chunks), then generates
Markdown lecture notes with a summary, key concepts, timeline, definitions,
review questions, a quiz with answers, flashcards, and action items — into a
local vault you own.

Built for **macOS Apple Silicon** (optimized for MacBook Air M5). No Ollama, no
local LLM downloads, no paid API calls by default: AI runs on the **Gemini
free tier** (Google AI Studio) behind a strict daily quota guard, and the whole
pipeline still works offline in fallback mode with no key at all.

## Features

- **Watch mode** — monitors a folder (default `~/Documents/Zoom`) for `.txt`,
  `.vtt`, `.srt`, `.md` transcript files and turns each into a note.
- **Live mode** — accepts live transcript chunks over HTTP
  (`POST /api/live/chunk`), appends them to a per-session transcript file, and
  maintains a rolling summary every N chunks / N minutes.
- **Live capture** — optional built-in bridge (Python + local faster-whisper)
  that turns Zoom/system audio into live chunks automatically, installed and
  controlled from the dashboard. Works on Windows (WASAPI loopback, no extra
  tools) and macOS (via BlackHole). See [docs/live-capture.md](docs/live-capture.md).
- **Web dashboard** at `http://localhost:3456` — active sessions, live
  transcript, rolling summary, generated notes, and manual paste/upload.
- **Markdown vault** (default `~/LearningVault`) — plain files, ready for
  Obsidian, Logseq, or manual upload to NotebookLM.
- **Cost guard** — `PAID_AI_DISABLED=true` by default (non-free-tier models are
  refused), `MAX_DAILY_CALLS=20` hard cap with a clear message when reached,
  and a zero-AI offline fallback so nothing ever blocks on the API.

## How it works

```
 Zoom / Whisper / captions                    you
        │                                      │
        ▼                                      ▼
  ~/Documents/Zoom            POST /api/live/chunk      paste in dashboard
   (.txt .vtt .srt .md)         (sessionId, text)               │
        │                              │                        │
        ▼                              ▼                        │
   file watcher  ──────────►  transcript parser  ◄──────────────┘
    (chokidar)                         │
                                       ▼
                          quota guard → Gemini free tier
                          (or offline extractive fallback)
                                       │
                                       ▼
                         ~/LearningVault/<date>-<title>.md
```

## Quick start (macOS)

```bash
git clone https://github.com/<your-username>/learning-harness.git
cd learning-harness
npm install

cp .env.example .env
# paste your free key from https://aistudio.google.com/apikey into GEMINI_API_KEY
# (optional — without a key, notes are generated in offline fallback mode)

npm start
```

Open <http://localhost:3456>, then try it:

```bash
cp samples/sample.vtt ~/Documents/Zoom/
# a note appears in ~/LearningVault within seconds
```

Full macOS setup (Homebrew, Node 20, autostart): [docs/macos-install.md](docs/macos-install.md).

## Requirements

- macOS on Apple Silicon (works elsewhere too — it's plain Node.js)
- Node.js **20+**
- Optionally: a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Configuration

All settings come from environment variables or `.env` (see
[.env.example](.env.example)). API keys are **never** hardcoded.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | *(empty)* | Free-tier key from Google AI Studio. Empty = offline fallback mode. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model to use. Configurable if the default is unavailable. |
| `PAID_AI_DISABLED` | `true` | Refuses any model not on the known free-tier list. |
| `MAX_DAILY_CALLS` | `20` | Hard daily cap on Gemini calls (persisted in SQLite, survives restarts). |
| `PORT` | `3456` | Dashboard/API port. |
| `WATCH_DIR` | `~/Documents/Zoom` | Folder watched for transcript files. |
| `VAULT_DIR` | `~/LearningVault` | Where Markdown notes are written. |
| `DATA_DIR` | `~/.learning-harness` | SQLite state + live session transcripts. |
| `SUMMARY_EVERY_CHUNKS` | `10` | Rolling summary refresh: every N chunks… |
| `SUMMARY_EVERY_MINUTES` | `5` | …or every N minutes, whichever comes first. |
| `WATCH_DISABLED` | `false` | Set `true` to disable the folder watcher. |

### The cost guard, precisely

1. No key → **zero** API calls; notes use the offline extractive fallback.
2. Key set → only free-tier models are allowed while `PAID_AI_DISABLED=true`;
   anything else is refused with an explanatory error.
3. Every successful call is counted per calendar day in SQLite. At
   `MAX_DAILY_CALLS` the server stops calling Gemini, returns
   `429 QUOTA_EXCEEDED` with a clear message, and note generation continues in
   fallback mode. The dashboard shows `Calls today: N/limit` at all times.

## Input modes

### 1. Watch mode

Drop (or let Zoom/Whisper drop) transcript files into `WATCH_DIR`. Supported:
`.txt` (including Zoom's tab-separated export), `.vtt`, `.srt`, `.md`.
Files are processed once per modification (tracked in SQLite), with
`awaitWriteFinish` so half-written files are never read.

### 2. Live mode

Send chunks as your transcription source produces them:

```bash
curl -X POST http://localhost:3456/api/live/chunk \
  -H 'Content-Type: application/json' \
  -d '{
    "sessionId": "bio-101",
    "timestamp": "2026-09-08T09:00:00Z",
    "speaker": "Dr. Lam",
    "text": "Photosynthesis converts light energy into chemical energy."
  }'
```

`sessionId` and `text` are required; `timestamp` and `speaker` are optional.
Chunks are appended to `DATA_DIR/sessions/<sessionId>.txt`, and the rolling
summary refreshes per the `SUMMARY_EVERY_*` settings. End the session to get
the final note:

```bash
curl -X POST http://localhost:3456/api/live/sessions/bio-101/end
```

See [docs/whisperasr-workflow.md](docs/whisperasr-workflow.md) for wiring a
local Whisper/WhisperASR pipeline into this endpoint — learning-harness does
not depend on it.

### 3. Manual paste

Paste any transcript into the dashboard form (or `POST /api/ingest` with
`{ "filename": "lecture.vtt", "text": "..." }`).

## API reference

| Method & path | Purpose |
| --- | --- |
| `GET /api/status` | AI/quota status, configured folders. |
| `POST /api/live/chunk` | Append a live transcript chunk. |
| `GET /api/live/sessions` | List live sessions. |
| `GET /api/live/sessions/:id` | Session detail + full transcript. |
| `POST /api/live/sessions/:id/end` | End session and generate the final note. |
| `POST /api/ingest` | Generate a note from pasted transcript text. |
| `GET /api/notes` | List notes in the vault. |
| `GET /api/notes/:name` | Fetch one note's Markdown. |
| `GET /api/capture/status` | Audio-capture bridge status (Python, deps, running). |
| `GET /api/capture/devices` | List audio input/loopback devices. |
| `POST /api/capture/install` | Install the bridge's Python dependencies. |
| `POST /api/capture/start` | Start capturing (`{sessionId, device?, model?, language?}`). |
| `POST /api/capture/stop` | Stop capturing. |

Errors use JSON with a `code`: `QUOTA_EXCEEDED` (429), `AI_UNAVAILABLE` (503),
`INVALID_REQUEST` (400).

## Note format

Every note contains: title, date/time, source (file or session id), executive
summary, key concepts, timeline, important definitions, questions to review,
quiz with answers, flashcards (Q/A), action items, and the raw transcript
(inline appendix, or a link to the session transcript file for live sessions).
See [samples/example-note.md](samples/example-note.md).

## NotebookLM

Notes are designed as clean NotebookLM sources for **manual** upload (no
automation — NotebookLM has no public API). See
[docs/notebooklm-workflow.md](docs/notebooklm-workflow.md).

## Project structure

```
learning-harness/
  src/
    server.ts              Express app, API routes, wiring
    config.ts              .env loading, defaults, free-tier model list
    quotaGuard.ts          SQLite-backed daily call limiter
    geminiClient.ts        Gemini REST client (free-tier enforcement)
    parsers/               TXT / VTT / SRT / MD → segments
    notes/                 prompts, Markdown renderer, note generator
    live/                  live session store + HTTP routes
    capture/               audio-capture bridge manager + routes
    watcher/               chokidar folder watcher
    db/                    SQLite schema/state
    ui/                    static dashboard (no build step)
  tests/                   vitest: parsers, quota, markdown, live store
  tools/                   live_capture.py (audio → Whisper → chunks bridge)
  samples/                 sample.vtt, sample.txt, example-note.md
  docs/                    macOS install, live capture, WhisperASR, NotebookLM guides
```

The UI is intentionally a static, server-hosted page (vanilla JS) rather than a
Vite+React app — zero build step, instant startup, tiny footprint.

## Development

```bash
npm run dev        # auto-restarting server
npm test           # vitest suite
npm run typecheck  # tsc --noEmit
```

## Privacy

Everything stays on your machine except the transcript text sent to the Gemini
API when (and only when) a key is configured. No telemetry, no accounts.

## License

MIT — see [LICENSE](LICENSE).
