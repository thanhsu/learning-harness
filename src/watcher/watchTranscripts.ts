import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_EXTENSIONS } from '../parsers/index.js';

const EXTS = new Set(SUPPORTED_EXTENSIONS);

export interface WatcherOptions {
  watchDir: string;
  /** Called for every added/changed transcript file (already extension-filtered). */
  onFile: (filePath: string) => Promise<unknown> | unknown;
  /** Skip files that already exist when the watcher starts (default: false). */
  ignoreInitial?: boolean;
}

/**
 * Watches a folder (e.g. ~/Documents/Zoom) for transcript files.
 * awaitWriteFinish avoids processing files that are still being written
 * by Zoom / Whisper exporters.
 */
export function startWatcher(opts: WatcherOptions): FSWatcher {
  fs.mkdirSync(opts.watchDir, { recursive: true });

  const watcher = chokidar.watch(opts.watchDir, {
    ignoreInitial: opts.ignoreInitial ?? false,
    depth: 3,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
  });

  const handle = (filePath: string): void => {
    if (!EXTS.has(path.extname(filePath).toLowerCase())) return;
    Promise.resolve(opts.onFile(filePath)).catch((err) => {
      console.error(
        `[watcher] Failed to process ${filePath}:`,
        err instanceof Error ? err.message : err
      );
    });
  };

  watcher.on('add', handle);
  watcher.on('change', handle);
  watcher.on('error', (err) => console.error('[watcher] error:', err));

  return watcher;
}
