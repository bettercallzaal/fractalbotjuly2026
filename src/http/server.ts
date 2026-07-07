import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeCommand } from '../commands/executeCommand.js';

/** Fallback control surface for the dashboard when the Supabase command
 * queue doesn't ack in time. Every request must carry the shared secret in
 * `x-bot-api-secret` - there is no other authentication on this server, so
 * it must never be exposed without that header check passing first. */
export function createHttpServer(supabase: SupabaseClient, apiSecret: string) {
  const app = express();
  app.use(express.json());

  app.post('/commands/:action', async (req, res) => {
    const authHeader = req.header('x-bot-api-secret');
    if (!authHeader) {
      res.status(401).json({ error: 'missing x-bot-api-secret header' });
      return;
    }
    if (authHeader !== apiSecret) {
      res.status(401).json({ error: 'invalid x-bot-api-secret' });
      return;
    }

    const { params = {}, idempotencyKey, requestedBy } = req.body as {
      params?: Record<string, unknown>;
      idempotencyKey: string;
      requestedBy: string;
    };

    // Validate required fields
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      res.status(400).json({ error: 'idempotencyKey is required' });
      return;
    }
    if (typeof requestedBy !== 'string' || requestedBy.length === 0) {
      res.status(400).json({ error: 'requestedBy is required' });
      return;
    }

    try {
      const result = await executeCommand(supabase, req.params.action, params, idempotencyKey, requestedBy);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  return app;
}
