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
import os
import sys
import urllib.request

SILENCE_RMS = 0.0010
SAMPLE_RATE = 16000

# Speaker-embedding model for --diarize (downloaded on first use, ~28 MB).
EMBEDDING_MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx"
)
EMBEDDING_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models", "speaker-embedding.onnx"
)


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


class Diarizer:
    """Per-utterance speaker labeling: computes a voice embedding for each
    utterance and clusters online — a familiar voice keeps its label, a new
    voice becomes "Speaker N". Whisper itself cannot tell speakers apart."""

    def __init__(self, np, threshold=0.52, max_speakers=6):
        import sherpa_onnx

        if not os.path.exists(EMBEDDING_MODEL_PATH):
            os.makedirs(os.path.dirname(EMBEDDING_MODEL_PATH), exist_ok=True)
            emit("status", message="Downloading speaker model (~28 MB, one time)...")
            urllib.request.urlretrieve(EMBEDDING_MODEL_URL, EMBEDDING_MODEL_PATH)

        self.np = np
        self.threshold = threshold
        self.max_speakers = max_speakers
        self.extractor = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=EMBEDDING_MODEL_PATH, num_threads=2
            )
        )
        self.manager = sherpa_onnx.SpeakerEmbeddingManager(self.extractor.dim)
        self.centroids = {}  # name -> (sum_vector, count)
        self.last_label = ""

    def _embed(self, audio):
        stream = self.extractor.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        stream.input_finished()
        if not self.extractor.is_ready(stream):
            return None
        e = self.np.asarray(self.extractor.compute(stream), dtype="float32")
        norm = float(self.np.linalg.norm(e))
        return e / norm if norm > 0 else None

    def _update_centroid(self, name, embedding):
        # Running mean voiceprint per speaker: more utterances = more stable.
        total, count = self.centroids.get(name, (0.0, 0))
        total = embedding if count == 0 else total + embedding
        self.centroids[name] = (total, count + 1)
        centroid = total / float(self.np.linalg.norm(total))
        self.manager.remove(name)
        self.manager.add(name, centroid.tolist())

    def label(self, audio):
        # Too little speech for a reliable voiceprint: stick with the last voice.
        if len(audio) < SAMPLE_RATE:
            return self.last_label
        embedding = self._embed(audio)
        if embedding is None:
            return self.last_label

        name = self.manager.search(embedding.tolist(), threshold=self.threshold)
        if not name:
            if self.manager.num_speakers < self.max_speakers:
                name = "Speaker %d" % (self.manager.num_speakers + 1)
                self.manager.add(name, embedding.tolist())
            else:
                # At capacity: take the closest known voice.
                name = (
                    self.manager.search(embedding.tolist(), threshold=0.0)
                    or self.last_label
                )
        self._update_centroid(name, embedding)
        self.last_label = name
        return name


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

    diarizer = None
    if args.diarize:
        try:
            diarizer = Diarizer(
                np,
                threshold=args.speaker_threshold,
                max_speakers=args.max_speakers,
            )
            emit("status", message="Speaker identification enabled.")
        except Exception as e:
            emit("error", message="Diarization unavailable (%s); continuing without it." % e)

    mic = pick_mic(sc, args.device)
    emit("status", message="Capturing from: %s" % mic.name)
    language = None if args.language in (None, "", "auto") else args.language

    def transcribe_and_post(audio, speech_audio):
        segments, _info = model.transcribe(
            audio, language=language, vad_filter=True, beam_size=1
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        if len(text) < 2:
            return
        speaker = args.speaker
        if diarizer is not None:
            try:
                # Voiceprint from speech-only frames (silence skews embeddings).
                speaker = diarizer.label(speech_audio) or args.speaker
            except Exception as e:
                emit("error", message="Speaker labeling failed: %s" % e)
        try:
            resp = post_chunk(args.server, args.session, text, speaker)
            emit(
                "chunk",
                text=text,
                speaker=speaker or None,
                chunkCount=(resp.get("session") or {}).get("chunkCount"),
                summaryUpdated=resp.get("summaryUpdated", False),
            )
        except Exception as e:
            emit("error", message="POST to learning-harness failed: %s" % e)

    # Utterance endpointing: read small blocks and flush a chunk when the
    # speaker pauses (>= SILENCE_HOLD s of silence) or hits the max window.
    # This yields complete sentences instead of fixed-size cuts, and captions
    # appear the moment a sentence ends.
    BLOCK_SECONDS = 0.3
    SILENCE_HOLD = 0.7  # trailing silence that ends an utterance
    MIN_SPEECH = 0.5  # ignore blips shorter than this
    block_frames = int(SAMPLE_RATE * BLOCK_SECONDS)
    max_frames = int(SAMPLE_RATE * max(args.window, 3.0))

    buffer = []
    speech_blocks = []
    buffered = 0
    silence_run = 0.0

    with mic.recorder(samplerate=SAMPLE_RATE, channels=1) as rec:
        emit("capturing", device=mic.name, model=args.model, session=args.session)
        while True:
            data = rec.record(numframes=block_frames)
            mono = data.mean(axis=1) if data.ndim > 1 else data
            mono = mono.astype("float32")
            rms = float(np.sqrt(np.mean(mono**2)))
            is_speech = rms >= SILENCE_RMS

            if is_speech:
                buffer.append(mono)
                speech_blocks.append(mono)
                buffered += len(mono)
                silence_run = 0.0
            elif buffer:
                # Keep a little trailing silence for natural word endings.
                buffer.append(mono)
                buffered += len(mono)
                silence_run += BLOCK_SECONDS

            utterance_ended = buffer and silence_run >= SILENCE_HOLD
            window_full = buffered >= max_frames
            if not (utterance_ended or window_full):
                continue

            audio = np.concatenate(buffer)
            speech_audio = (
                np.concatenate(speech_blocks) if speech_blocks else audio[:0]
            )
            buffer, speech_blocks, buffered, silence_run = [], [], 0, 0.0
            if len(speech_audio) >= int(SAMPLE_RATE * MIN_SPEECH):
                transcribe_and_post(audio, speech_audio)


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
    p.add_argument(
        "--diarize",
        action="store_true",
        help="identify different voices and label chunks Speaker 1/2/... (experimental)",
    )
    p.add_argument("--max-speakers", type=int, default=6)
    p.add_argument(
        "--speaker-threshold",
        type=float,
        default=0.52,
        help="voice-match threshold: lower merges voices, higher splits them",
    )
    p.add_argument("--server", default="http://localhost:3456")
    p.add_argument("--language", default="auto", help='e.g. "vi", "en", or "auto"')
    p.add_argument(
        "--window",
        type=float,
        default=10.0,
        help="max seconds per chunk (utterances usually end sooner, at a pause)",
    )
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
