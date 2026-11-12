import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import type { AppEnv } from './env';
import { transactions } from './routes/transactions';

// Static Angular files are served by Cloudflare's asset layer before this code runs
// (see "run_worker_first" in wrangler.jsonc), so this app only handles /api/*.
const app = new Hono<AppEnv>().basePath('/api');

app.use(logger());

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route('/transactions', transactions);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
