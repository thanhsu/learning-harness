# Whisper / WhisperASR Workflow (optional)

learning-harness does **not** depend on any speech-to-text engine. It consumes
transcripts — files dropped into the watch folder, or live chunks POSTed to the
HTTP API. If your class doesn't provide captions, you can produce transcripts
locally with Whisper-family tools. All options below are free and run on
Apple Silicon.

## Option A — Zoom's built-in captions (easiest, zero install)

1. In Zoom: *Settings → Accessibility → enable captions*, and ask the host to
   allow "Save Captions".
2. After the meeting, Zoom saves `closed_caption.txt` / transcript files into
   `~/Documents/Zoom/<meeting folder>/`.
3. learning-harness watches `~/Documents/Zoom` recursively — the note is
   generated automatically.

## Option B — whisper.cpp for file-based transcription

[whisper.cpp](https://github.com/ggml-org/whisper.cpp) runs Whisper natively on
the M-series Neural Engine/GPU.

```bash
brew install whisper-cpp
# download a model once (small = good balance of speed/quality)
curl -L -o ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# record or export the class audio (m4a/wav), then:
whisper-cli -m ggml-small.bin -f lecture.m4a --output-vtt --output-file lecture
cp lecture.vtt ~/Documents/Zoom/
```

The `.vtt` lands in the watch folder and a note is generated.

## Option C — WhisperASR webservice for near-live transcription

[whisper-asr-webservice](https://github.com/ahmetoner/whisper-asr-webservice)
exposes Whisper over HTTP. Install it separately (Docker or pip), point it at
your class audio, and forward the text to learning-harness as live chunks.

To capture Zoom's audio on macOS you need a loopback device such as
[BlackHole](https://existential.audio/blackhole/) (free):

```bash
brew install blackhole-2ch
```

Set BlackHole as a multi-output device so you both hear the class and record it,
then transcribe the recorded stream in chunks and POST each result:

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

A minimal bridge loop (pseudo-shell) that replays any transcript source line by
line:

```bash
while IFS= read -r line; do
  jq -n --arg t "$line" '{sessionId:"bio-101", text:$t}' |
    curl -s -X POST http://localhost:3456/api/live/chunk \
      -H 'Content-Type: application/json' -d @-
  sleep 2
done < live-captions.txt
```

While chunks arrive, the dashboard at <http://localhost:3456> shows the live
transcript and refreshes a rolling summary every `SUMMARY_EVERY_CHUNKS` chunks
or `SUMMARY_EVERY_MINUTES` minutes. When class ends, click **End session &
generate note** (or `POST /api/live/sessions/<id>/end`) to produce the final
Markdown note.

## Cost note

Whisper tools above are local and free. Only the summarization/quiz generation
calls Gemini, and those calls are capped by `MAX_DAILY_CALLS` (default 20/day)
on the free tier.
