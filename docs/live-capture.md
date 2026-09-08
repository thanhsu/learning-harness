# Live Capture — Zoom audio → live transcript (built-in bridge)

The **Live capture** panel on the dashboard turns Zoom (or any meeting app)
audio into a live transcript session automatically:

```
Zoom audio → system audio capture → faster-whisper (local, free)
           → POST /api/live/chunk → live transcript + rolling summary → note
```

Audio never leaves your machine — Whisper runs locally
([tools/live_capture.py](../tools/live_capture.py)); only the recognized text
is sent to `localhost`. The only cloud calls remain the quota-guarded Gemini
summaries.

## One-time setup

**macOS:** the one-click installer does everything (Python, BlackHole, the
bridge's venv) — double-click `scripts/install-mac.command`. See
[macos-install.md](macos-install.md).

**Windows (or manual) — from the UI:**

1. Install **Python 3.9+**
   - Windows: `winget install Python.Python.3.12` (or python.org)
   - macOS: `brew install python`
2. Open the dashboard → **Live capture** panel → click **Install dependencies**.
   This creates a project virtualenv (`.venv/`) and installs
   `tools/requirements.txt` into it (numpy, soundcard, faster-whisper —
   roughly 200 MB one-time).
3. The panel switches to **Ready** when done.

## Capturing a meeting

1. Pick an audio device:
   - **Windows**: leave **Auto** — the bridge uses WASAPI *loopback* of your
     speakers (🔁 devices in the list), so it hears exactly what you hear in
     Zoom. No virtual cable needed.
   - **macOS**: macOS has no built-in loopback. Install
     [BlackHole](https://existential.audio/blackhole/) once
     (`brew install blackhole-2ch`), create a Multi-Output Device
     (Audio MIDI Setup → `+` → Multi-Output → check both your speakers and
     BlackHole) and set it as the system output. Then pick the **BlackHole**
     device in the dropdown (Auto also prefers it when present).
   - A 🎤 microphone also works — useful for in-person classes.
2. Choose a Whisper model: `tiny` (fastest) / `base` (good default) /
   `small` (best quality, needs a faster machine). First start downloads the
   model (~75–500 MB one-time).
3. Optionally set the language (`vi`, `en`, … or leave `auto`).
4. Press **▶ Start capture**, join your Zoom meeting, and watch the session
   appear under **Live sessions** with a growing transcript and rolling
   summary. Audio is transcribed in ~8-second windows; silence is skipped.
5. After class, press **■ Stop capture**, open the session, and click
   **End session & generate note**.

## CLI (without the UI)

```bash
python tools/live_capture.py --list-devices
python tools/live_capture.py --session bio-101 --model base --language vi
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Python 3 not found" | Install Python and restart the harness (it probes `py`/`python`/`python3`). |
| Install fails | Run `pip install -r tools/requirements.txt` manually to see the full error. |
| No 🔁 loopback device on Windows | Update audio drivers; any playback device should expose a loopback entry. |
| Silent transcript on macOS | Zoom output must go through the Multi-Output Device that includes BlackHole. |
| Transcription lags behind | Use a smaller model (`tiny`/`base`); windows longer than the transcribe time will queue. |
| Garbage text during silence/music | Expected occasionally; the VAD filter removes most of it. |
