import { Hono, type Context } from 'hono';
import type { AppEnv } from '../env.ts';
import { serviceAccountEmail } from '../firestore.ts';
import { requireAuth } from '../middleware/auth.ts';
import { type Profile, MONTHS, newId } from '../model.ts';
import { repo } from '../repo.ts';
import { type SyncTarget, syncToSheet } from '../sync.ts';
import { bad, body, bool, notFound, num, oneOf, str } from '../validate.ts';

const r = (c: Context<AppEnv>) => repo(c.env, c.get('uid'));
const mirror = (c: Context<AppEnv>, target: SyncTarget) => c.executionCtx.waitUntil(syncToSheet(c.env, c.get('uid'), target));
const today = () => new Date().toISOString().slice(0, 10);

const reply = (c: Context<AppEnv>, profile: Profile, status: 200 | 201 = 200) =>
  c.json({ profile, serviceAccountEmail: serviceAccountEmail(c.env) }, status);

/** Accepts a sheet ID or a full Google Sheets URL. */
function parseSheetId(input: string): string {
  const id = input.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? input;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(id)) throw bad('That does not look like a Google Sheet ID or link');
  return id;
}

export const profile = new Hono<AppEnv>()
  .use(requireAuth)

  .get('/profile', async (c) => reply(c, await r(c).getProfile()))

  /** Every item (trip, purchase, …) of every year with its amounts — for the Trips page. */
  .get('/items', async (c) => {
    const repo_ = r(c);
    const p = await repo_.getProfile();
    const years = await Promise.all(p.years.map((y) => repo_.getYear(y)));
    const items = years.flatMap((data) => {
      if (!data) return [];
      const catName = new Map(data.year.categories.map((cat) => [cat.id, cat.name]));
      return data.year.items.map((it) => ({
        year: data.year.year,
        id: it.id,
        name: it.name,
        categoryId: it.categoryId,
        categoryName: catName.get(it.categoryId) ?? '',
        month: it.month,
        entries: MONTHS.flatMap((m) =>
          (data.months[m] ?? []).filter((e) => e.itemId === it.id).map((e) => ({ id: e.id, month: m, amount: e.amount, note: e.note })),
        ),
      }));
    });
    return c.json({ items });
  })

  // ----- settings / sheet mirror -----
  .put('/settings', async (c) => {
    const b = await body(c);
    const raw = str(b, 'sheetId', { optional: true, max: 300 });
    const sheetId = raw ? parseSheetId(raw) : undefined;
    const { profile: p } = await r(c).mutateProfile((p) => {
      p.sheetId = sheetId;
      if (!sheetId) p.lastSync = undefined;
    });
    if (sheetId) mirror(c, { all: true });
    return reply(c, p);
  })
  .post('/sync', async (c) => {
    const repo_ = r(c);
    const p = await repo_.getProfile();
    if (!p.sheetId) throw bad('No sheet linked');
    const lastSync = await syncToSheet(c.env, c.get('uid'), { all: true }, p);
    return reply(c, { ...p, lastSync });
  })

  // ----- accounts (for the monthly count) -----
  .post('/accounts', async (c) => {
    const name = str(await body(c), 'name')!;
    const { profile: p } = await r(c).mutateProfile((p) => {
      p.accounts.push({ id: newId(), name, order: Math.max(-1, ...p.accounts.map((a) => a.order)) + 1 });
    });
    return reply(c, p, 201);
  })
  .patch('/accounts/:id', async (c) => {
    const b = await body(c);
    const name = str(b, 'name', { optional: true });
    const archived = bool(b, 'archived');
    const { profile: p } = await r(c).mutateProfile((p) => {
      const a = p.accounts.find((x) => x.id === c.req.param('id'));
      if (!a) throw notFound('Account');
      if (name) a.name = name;
      if (archived !== undefined) a.archived = archived || undefined;
    });
    return reply(c, p);
  })
  .post('/accounts/:id/move', async (c) => {
    const dir = oneOf(await body(c), 'direction', ['up', 'down'] as const)!;
    const { profile: p } = await r(c).mutateProfile((p) => {
      const list = [...p.accounts].sort((a, b) => a.order - b.order);
      const i = list.findIndex((x) => x.id === c.req.param('id'));
      const j = dir === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i]!.order, list[j]!.order] = [list[j]!.order, list[i]!.order];
    });
    return reply(c, p);
  })

  // ----- funds (standalone pots outside the monthly cash flow) -----
  .post('/funds', async (c) => {
    const b = await body(c);
    const name = str(b, 'name')!;
    const initial = num(b, 'initial', { optional: true });
    const { profile: p } = await r(c).mutateProfile((p) => {
      p.funds.push({
        id: newId(),
        name,
        order: Math.max(-1, ...p.funds.map((f) => f.order)) + 1,
        entries: initial ? [{ id: newId(), amount: initial, note: 'Initial amount', date: today() }] : [],
      });
    });
    mirror(c, { funds: true });
    return reply(c, p, 201);
  })
  .patch('/funds/:id', async (c) => {
    const b = await body(c);
    const name = str(b, 'name', { optional: true });
    const archived = bool(b, 'archived');
    const { profile: p } = await r(c).mutateProfile((p) => {
      const f = p.funds.find((x) => x.id === c.req.param('id'));
      if (!f) throw notFound('Fund');
      if (name) f.name = name;
      if (archived !== undefined) f.archived = archived || undefined;
    });
    mirror(c, { funds: true });
    return reply(c, p);
  })
  .delete('/funds/:id', async (c) => {
    const { profile: p } = await r(c).mutateProfile((p) => (p.funds = p.funds.filter((f) => f.id !== c.req.param('id'))));
    mirror(c, { funds: true });
    return reply(c, p);
  })
  .post('/funds/:id/entries', async (c) => {
    const b = await body(c);
    const amount = num(b, 'amount')!;
    if (amount === 0) throw bad('amount cannot be 0');
    const note = str(b, 'note', { optional: true, max: 200 });
    const date = str(b, 'date', { optional: true }) ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date must be yyyy-mm-dd');
    const { profile: p } = await r(c).mutateProfile((p) => {
      const f = p.funds.find((x) => x.id === c.req.param('id'));
      if (!f) throw notFound('Fund');
      f.entries.push({ id: newId(), amount, note, date });
    });
    mirror(c, { funds: true });
    return reply(c, p, 201);
  })
  .delete('/funds/:id/entries/:eid', async (c) => {
    const { profile: p } = await r(c).mutateProfile((p) => {
      const f = p.funds.find((x) => x.id === c.req.param('id'));
      if (!f) throw notFound('Fund');
      f.entries = f.entries.filter((e) => e.id !== c.req.param('eid'));
    });
    mirror(c, { funds: true });
    return reply(c, p);
  });
