import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CaptureEvent {
  event: string;
  at: string;
  [key: string]: unknown;
}

export interface CaptureDevice {
  index: number;
  name: string;
  loopback: boolean;
}

export interface CaptureStartOptions {
  sessionId: string;
  device?: string;
  model?: string;
  language?: string;
  /** Label attached to every chunk (Whisper cannot tell speakers apart). */
  speaker?: string;
  /** Seconds of audio per transcription window (smaller = lower latency). */
  windowSeconds?: number;
}

export const CAPTURE_MODELS = ['tiny', 'base', 'small', 'medium'];

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools', 'live_capture.py');
const REQUIREMENTS_PATH = path.join(REPO_ROOT, 'tools', 'requirements.txt');
const VENV_DIR = path.join(REPO_ROOT, '.venv');
// Project virtualenv, preferred when present. Keeps macOS happy (Homebrew
// Python refuses global pip installs, PEP 668) and isolates deps everywhere.
const VENV_PYTHON = path.join(
  VENV_DIR,
  ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'])
);
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Parses complete JSON lines out of a stream buffer; returns leftover text. */
export function parseEventLines(
  buffer: string,
  onEvent: (ev: Record<string, unknown>) => void
): string {
  const lines = buffer.split(/\r?\n/);
  const leftover = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') onEvent(parsed);
    } catch {
      onEvent({ event: 'log', message: trimmed });
    }
  }
  return leftover;
}

/**
 * Manages the optional Python audio-capture bridge (tools/live_capture.py):
 * probes for Python, installs its dependencies on request, lists audio
 * devices, and starts/stops the capture process. Everything is exposed to the
 * dashboard via /api/capture/*.
 */
export class CaptureManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private events: CaptureEvent[] = [];
  private sessionId: string | undefined;
  private pythonCmd: string | null | undefined; // undefined = not probed yet
  private depsReady: boolean | undefined;
  private installing = false;
  private installLog: string[] = [];
  private installExitCode: number | undefined;

  constructor(private readonly serverUrl: string) {}

  private pushEvent(ev: Record<string, unknown>): void {
    this.events.push({ event: 'log', ...ev, at: new Date().toISOString() } as CaptureEvent);
    if (this.events.length > 30) this.events.shift();
  }

  findPython(): string | null {
    // The project venv always wins (it holds the bridge's dependencies).
    if (fs.existsSync(VENV_PYTHON)) {
      this.pythonCmd = VENV_PYTHON;
      return VENV_PYTHON;
    }
    if (this.pythonCmd !== undefined) return this.pythonCmd;
    const candidates =
      process.platform === 'win32'
        ? ['py', 'python', 'python3']
        : ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 5000 });
        if (r.status === 0) {
          this.pythonCmd = cmd;
          return cmd;
        }
      } catch {
        /* try next */
      }
    }
    this.pythonCmd = null;
    return null;
  }

  /** Runs the bridge script with args, collecting its JSON events until exit. */
  private runScript(
    args: string[],
    timeoutMs: number
  ): Promise<{ events: Record<string, unknown>[]; code: number | null }> {
    const python = this.findPython();
    if (!python) return Promise.reject(new Error('Python is not installed.'));

    return new Promise((resolve) => {
      const events: Record<string, unknown>[] = [];
      const child = spawn(python, ['-u', SCRIPT_PATH, ...args]);
      let buf = '';
      let errBuf = '';
      const timer = setTimeout(() => child.kill(), timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        buf = parseEventLines(buf + d.toString('utf8'), (ev) => events.push(ev));
      });
      child.stderr.on('data', (d: Buffer) => {
        errBuf = (errBuf + d.toString('utf8')).slice(-2000);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && events.length === 0 && errBuf.trim()) {
          events.push({ event: 'error', message: errBuf.trim().slice(0, 500) });
        }
        resolve({ events, code });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        events.push({ event: 'error', message: err.message });
        resolve({ events, code: null });
      });
    });
  }

  async checkDeps(): Promise<{ ready: boolean; error?: string }> {
    const { events } = await this.runScript(['--check'], 30_000);
    const ready = events.some((e) => e.event === 'ready');
    const error = events.find((e) => e.event === 'error')?.message as
      | string
      | undefined;
    this.depsReady = ready;
    return { ready, error };
  }

  async listDevices(): Promise<{ devices: CaptureDevice[]; error?: string }> {
    const { events } = await this.runScript(['--list-devices'], 30_000);
    const devicesEvent = events.find((e) => e.event === 'devices');
    const error = events.find((e) => e.event === 'error')?.message as
      | string
      | undefined;
    return {
      devices: (devicesEvent?.devices as CaptureDevice[]) ?? [],
      error,
    };
  }

  /**
   * Installs the bridge's Python dependencies into the project virtualenv
   * (creating .venv first when needed); the UI polls status while it runs.
   */
  installDeps(): { started: boolean; error?: string } {
    if (this.installing) return { started: false, error: 'Install already running.' };
    const python = this.findPython();
    if (!python) return { started: false, error: 'Python is not installed.' };

    this.installing = true;
    this.installExitCode = undefined;
    this.installLog = [];

    const appendTo = (d: Buffer) => {
      for (const line of d.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) this.installLog.push(line.trim());
      }
      if (this.installLog.length > 50) {
        this.installLog = this.installLog.slice(-50);
      }
    };

    const runStep = (
      label: string,
      cmd: string,
      args: string[],
      onDone: (code: number) => void
    ) => {
      this.installLog.push(`$ ${label}`);
      const child = spawn(cmd, args);
      child.stdout.on('data', appendTo);
      child.stderr.on('data', appendTo);
      child.on('close', (code) => onDone(code ?? -1));
      child.on('error', (err) => {
        this.installLog.push(`spawn failed: ${err.message}`);
        onDone(-1);
      });
    };

    const finish = (code: number) => {
      this.installing = false;
      this.installExitCode = code;
      this.pythonCmd = undefined; // re-probe: the venv may exist now
      this.depsReady = undefined; // force a fresh --check
      if (code === 0) void this.checkDeps();
    };

    const pipInstall = () =>
      runStep(
        'pip install -r tools/requirements.txt',
        VENV_PYTHON,
        ['-m', 'pip', 'install', '-r', REQUIREMENTS_PATH],
        finish
      );

    if (fs.existsSync(VENV_PYTHON)) {
      pipInstall();
    } else {
      runStep(
        'python -m venv .venv',
        python,
        ['-m', 'venv', VENV_DIR],
        (code) => (code === 0 ? pipInstall() : finish(code))
      );
    }
    return { started: true };
  }

  start(opts: CaptureStartOptions): { started: boolean; error?: string } {
    if (this.proc) return { started: false, error: 'Capture is already running.' };
    const python = this.findPython();
    if (!python) return { started: false, error: 'Python is not installed.' };
    if (!SESSION_ID_RE.test(opts.sessionId ?? '')) {
      return { started: false, error: 'Invalid session id.' };
    }
    const model = opts.model || 'base';
    if (!CAPTURE_MODELS.includes(model)) {
      return { started: false, error: `Model must be one of: ${CAPTURE_MODELS.join(', ')}` };
    }

    const args = [
      '-u',
      SCRIPT_PATH,
      '--session',
      opts.sessionId,
      '--server',
      this.serverUrl,
      '--model',
      model,
    ];
    if (opts.device) args.push('--device', String(opts.device));
    if (opts.language && opts.language !== 'auto') {
      args.push('--language', opts.language);
    }
    if (opts.speaker?.trim()) args.push('--speaker', opts.speaker.trim());
    const window = Number(opts.windowSeconds);
    if (Number.isFinite(window) && window >= 3 && window <= 30) {
      args.push('--window', String(window));
    }

    this.events = [];
    this.sessionId = opts.sessionId;
    this.pushEvent({ event: 'status', message: 'Starting capture process...' });

    const child = spawn(python, args);
    this.proc = child;
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf = parseEventLines(buf + d.toString('utf8'), (ev) => this.pushEvent(ev));
    });
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8').trim();
      // faster-whisper prints progress bars to stderr; keep only short lines.
      if (text && text.length < 300) this.pushEvent({ event: 'log', message: text });
    });
    child.on('close', (code) => {
      this.pushEvent({
        event: 'stopped',
        message: `Capture process exited (code ${code ?? 'killed'}).`,
      });
      this.proc = null;
    });
    child.on('error', (err) => {
      this.pushEvent({ event: 'error', message: err.message });
      this.proc = null;
    });

    return { started: true };
  }

  stop(): { stopped: boolean } {
    if (!this.proc) return { stopped: false };
    this.proc.kill();
    return { stopped: true };
  }

  status() {
    return {
      pythonFound: this.findPython() !== null,
      pythonCmd: this.pythonCmd ?? null,
      depsReady: this.depsReady ?? null,
      installing: this.installing,
      installExitCode: this.installExitCode ?? null,
      installLogTail: this.installLog.slice(-6),
      running: this.proc !== null,
      sessionId: this.sessionId ?? null,
      events: this.events.slice(-10),
    };
  }
}
