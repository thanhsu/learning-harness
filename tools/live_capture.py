#!/usr/bin/env python3
"""Live audio -> Whisper -> learning-harness bridge.

Captures system audio (Windows: WASAPI loopback, built in; macOS: a loopback
device such as BlackHole, or any microphone), transcribes it locally with
faster-whisper, and POSTs each utterance to the learning-harness live API.

All output is JSON lines ({"event": ...}) so the server/UI can display status.
Runs 100% locally — audio never leaves the machine; only the resulting text is
sent to localhost.
"""

import argparse
import json
import sys
import urllib.request

SILENCE_RMS = 0.0010
SAMPLE_RATE = 16000


def emit(event, **kw):
    print(json.dumps({"event": event, **kw}, ensure_ascii=False), flush=True)


def fail(message, code=2):
    emit("error", message=message)
    sys.exit(code)


def import_audio_deps():
    try:
        import numpy  # noqa: F401
        import soundcard  # noqa: F401
    except Exception as e:  # ImportError or platform lib load errors
        fail(
            "Missing/broken Python dependency (%s). Install with: "
            "pip install -r tools/requirements.txt" % e
        )
    import numpy as np
    import soundcard as sc

    return np, sc


def list_devices():
    _np, sc = import_audio_deps()
    devices = []
    for i, m in enumerate(sc.all_microphones(include_loopback=True)):
        devices.append(
            {
                "index": i,
                "name": m.name,
                "loopback": bool(getattr(m, "isloopback", False)),
            }
        )
    emit("devices", devices=devices)


def check():
    import_audio_deps()
    try:
        import faster_whisper  # noqa: F401
    except Exception as e:
        fail("faster-whisper is not installed (%s)." % e)
    emit("ready")


def pick_mic(sc, spec):
    mics = sc.all_microphones(include_loopback=True)
    if not mics:
        fail("No audio input devices found.")
    if spec:
        if spec.isdigit() and 0 <= int(spec) < len(mics):
            return mics[int(spec)]
        low = spec.lower()
        for m in mics:
            if low in m.name.lower():
                return m
        fail('No audio device matches "%s". Use --list-devices.' % spec)
    # Auto-pick: Windows loopback (system audio) > BlackHole (macOS) > default mic.
    for m in mics:
        if getattr(m, "isloopback", False):
            return m
    for m in mics:
        if "blackhole" in m.name.lower():
            return m
    return sc.default_microphone()


def post_chunk(server, session, text, speaker=""):
    payload = {"sessionId": session, "text": text}
    if speaker:
        payload["speaker"] = speaker
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        server.rstrip("/") + "/api/live/chunk",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)


def run(args):
    np, sc = import_audio_deps()
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        fail("faster-whisper is not installed (%s)." % e)

    emit(
        "status",
        message='Loading Whisper model "%s" (first run downloads it — please wait)...'
        % args.model,
    )
    model = WhisperModel(args.model, device="auto", compute_type="int8")

    mic = pick_mic(sc, args.device)
    emit("status", message="Capturing from: %s" % mic.name)
    language = None if args.language in (None, "", "auto") else args.language

    frames = int(SAMPLE_RATE * args.window)
    with mic.recorder(samplerate=SAMPLE_RATE, channels=1) as rec:
        emit("capturing", device=mic.name, model=args.model, session=args.session)
        while True:
            data = rec.record(numframes=frames)
            mono = data.mean(axis=1) if data.ndim > 1 else data
            mono = mono.astype("float32")
            rms = float(np.sqrt(np.mean(mono**2)))
            if rms < SILENCE_RMS:
                continue
            segments, _info = model.transcribe(
                mono, language=language, vad_filter=True, beam_size=1
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            if len(text) < 2:
                continue
            try:
                resp = post_chunk(args.server, args.session, text, args.speaker)
                emit(
                    "chunk",
                    text=text,
                    chunkCount=(resp.get("session") or {}).get("chunkCount"),
                    summaryUpdated=resp.get("summaryUpdated", False),
                )
            except Exception as e:
                emit("error", message="POST to learning-harness failed: %s" % e)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--list-devices", action="store_true")
    p.add_argument("--check", action="store_true")
    p.add_argument("--device", default="", help="device index or name substring")
    p.add_argument("--model", default="base", help="tiny/base/small/medium")
    p.add_argument("--session", default="zoom-live")
    p.add_argument(
        "--speaker",
        default="",
        help="label attached to every chunk (e.g. the lecturer's name)",
    )
    p.add_argument("--server", default="http://localhost:3456")
    p.add_argument("--language", default="auto", help='e.g. "vi", "en", or "auto"')
    p.add_argument("--window", type=float, default=8.0, help="seconds per chunk")
    args = p.parse_args()

    if args.list_devices:
        list_devices()
    elif args.check:
        check()
    else:
        try:
            run(args)
        except KeyboardInterrupt:
            emit("status", message="Capture stopped.")


if __name__ == "__main__":
    main()
