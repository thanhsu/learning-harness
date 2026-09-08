import { Router } from 'express';
import type { LiveSessionStore } from './liveSessionStore.js';

export interface LiveRouterDeps {
  store: LiveSessionStore;
  /** Generates the final Markdown note for an ended session. */
  finalize: (sessionId: string) => Promise<{ notePath: string }>;
}

export function createLiveRouter(deps: LiveRouterDeps): Router {
  const router = Router();

  // Live transcript ingestion:
  // POST /api/live/chunk { sessionId, timestamp?, speaker?, text }
  router.post('/api/live/chunk', async (req, res, next) => {
    try {
      const { sessionId, timestamp, speaker, text } = req.body ?? {};
      const { session, summaryUpdated } = await deps.store.appendChunk({
        sessionId,
        timestamp,
        speaker,
        text,
      });
      res.json({ ok: true, summaryUpdated, session });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/live/sessions', (_req, res) => {
    res.json({ sessions: deps.store.list() });
  });

  router.get('/api/live/sessions/:id', (req, res) => {
    const session = deps.store.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: `Unknown session "${req.params.id}".` });
      return;
    }
    res.json({ session, transcript: deps.store.readTranscript(req.params.id) });
  });

  // Ends the session and generates the final note in the vault.
  router.post('/api/live/sessions/:id/end', async (req, res, next) => {
    try {
      const session = deps.store.get(req.params.id);
      if (!session) {
        res.status(404).json({ error: `Unknown session "${req.params.id}".` });
        return;
      }
      deps.store.end(req.params.id);
      const { notePath } = await deps.finalize(req.params.id);
      res.json({ ok: true, notePath });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
