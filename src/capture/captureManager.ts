import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
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
}

export const CAPTURE_MODELS = ['tiny', 'base', 'small', 'medium'];

const SCRIPT_PATH = fileURLToPath(
  new URL('../../tools/live_capture.py', import.meta.url)
);
const REQUIREMENTS_PATH = fileURLToPath(
  new URL('../../tools/requirements.txt', import.meta.url)
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

  /** Kicks off `pip install -r tools/requirements.txt`; UI polls status. */
  installDeps(): { started: boolean; error?: string } {
    if (this.installing) return { started: false, error: 'Install already running.' };
    const python = this.findPython();
    if (!python) return { started: false, error: 'Python is not installed.' };

    this.installing = true;
    this.installExitCode = undefined;
    this.installLog = ['$ pip install -r tools/requirements.txt'];

    const child = spawn(python, ['-m', 'pip', 'install', '-r', REQUIREMENTS_PATH]);
    const append = (d: Buffer) => {
      for (const line of d.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) this.installLog.push(line.trim());
      }
      if (this.installLog.length > 50) {
        this.installLog = this.installLog.slice(-50);
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('close', (code) => {
      this.installing = false;
      this.installExitCode = code ?? -1;
      this.depsReady = undefined; // force a fresh --check
      if (code === 0) void this.checkDeps();
    });
    child.on('error', (err) => {
      this.installing = false;
      this.installExitCode = -1;
      this.installLog.push(`spawn failed: ${err.message}`);
    });
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
