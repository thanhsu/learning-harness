import { Router } from 'express';
import type { CaptureManager } from './captureManager.js';

export function createCaptureRouter(manager: CaptureManager): Router {
  const router = Router();

  router.get('/api/capture/status', async (_req, res) => {
    const status = manager.status();
    // Probe dependencies once (lazily) when Python exists but we never checked.
    if (status.pythonFound && status.depsReady === null && !status.installing) {
      try {
        await manager.checkDeps();
      } catch {
        /* surfaced via status on next poll */
      }
      res.json(manager.status());
      return;
    }
    res.json(status);
  });

  router.get('/api/capture/devices', async (_req, res, next) => {
    try {
      res.json(await manager.listDevices());
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/capture/install', (_req, res) => {
    const r = manager.installDeps();
    if (!r.started) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/api/capture/start', (req, res) => {
    const { sessionId, device, model, language, speaker, windowSeconds } =
      req.body ?? {};
    const r = manager.start({
      sessionId: typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'zoom-live',
      device: typeof device === 'string' ? device : undefined,
      model: typeof model === 'string' ? model : undefined,
      language: typeof language === 'string' ? language.trim() : undefined,
      speaker: typeof speaker === 'string' ? speaker : undefined,
      windowSeconds: Number(windowSeconds) || undefined,
    });
    if (!r.started) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/api/capture/stop', (_req, res) => {
    res.json(manager.stop());
  });

  return router;
}
