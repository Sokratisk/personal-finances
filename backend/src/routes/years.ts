import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env.ts';
import { requireAuth } from '../middleware/auth.ts';
import { type Category, type Entry, type Kind, type YearDoc, MONTHS, emptyYear, newId } from '../model.ts';
import { repo } from '../repo.ts';
import { syncToSheet } from '../sync.ts';
import { bad, body, bool, monthParam, notFound, num, oneOf, str, yearParam } from '../validate.ts';

const KINDS: readonly Kind[] = ['income', 'expense', 'stocks'];
const r = (c: Context<AppEnv>) => repo(c.env, c.get('uid'));
/** Mirror the year to the user's sheet after responding. */
const mirror = (c: Context<AppEnv>, year: number) =>
  c.executionCtx.waitUntil(syncToSheet(c.env, c.get('uid'), { years: [year] }));

const findCat = (doc: YearDoc, id: string) => doc.categories.find((x) => x.id === id) ?? (() => { throw notFound('Category'); })();
const findItem = (doc: YearDoc, id: string) => doc.items.find((x) => x.id === id) ?? (() => { throw notFound('Item'); })();
/** Re-number orders 0..n so inserts/moves stay simple. */
const renumber = (cats: Category[]) => [...cats].sort((a, b) => a.order - b.order).forEach((c, i) => (c.order = i));

export const years = new Hono<AppEnv>()
  .use(requireAuth)

  // ----- years -----
  .get('/:y', async (c) => {
    const data = await r(c).getYear(yearParam(c.req.param('y')));
    if (!data) throw notFound('Year');
    return c.json(data);
  })
  .post('/', async (c) => {
    const b = await body(c);
    const year = yearParam(String(b.year));
    const opening = num(b, 'opening', { optional: true }) ?? 0;
    const copyFrom = b.copyFrom === undefined ? undefined : yearParam(String(b.copyFrom));
    const categoryIds = Array.isArray(b.categoryIds) ? (b.categoryIds as unknown[]).map(String) : undefined;
    const repo_ = r(c);
    if (await repo_.getYearDoc(year)) throw new HTTPException(409, { message: `${year} already exists` });

    const doc = emptyYear(year);
    doc.opening = opening;
    if (copyFrom) {
      const src = await repo_.getYearDoc(copyFrom);
      if (!src) throw notFound('Year to copy from');
      doc.categories = src.categories
        .filter((cat) => (categoryIds ? categoryIds.includes(cat.id) : !cat.archived))
        .map((cat) => ({ ...cat, archived: undefined }));
      renumber(doc.categories);
    }
    const { year: saved } = await repo_.mutateYear(year, (d) => Object.assign(d, doc));
    const { profile } = await repo_.mutateProfile((p) => {
      if (!p.years.includes(year)) p.years.push(year);
      p.years.sort((a, b2) => a - b2);
    });
    mirror(c, year);
    return c.json({ year: saved, profile }, 201);
  })
  .patch('/:y', async (c) => {
    const y = yearParam(c.req.param('y'));
    const b = await body(c);
    const opening = num(b, 'opening');
    const { year } = await r(c).mutateYear(y, (d) => (d.opening = opening!));
    mirror(c, y);
    return c.json({ year });
  })

  // ----- categories -----
  .post('/:y/categories', async (c) => {
    const y = yearParam(c.req.param('y'));
    const b = await body(c);
    const name = str(b, 'name')!;
    const kind = oneOf(b, 'kind', KINDS)!;
    const group = str(b, 'group', { optional: true }) ?? (kind === 'expense' ? 'Other' : kind === 'income' ? 'Income' : 'Stocks');
    const { year } = await r(c).mutateYear(y, (d) => {
      if (d.categories.some((x) => x.kind === kind && x.name.toLowerCase() === name.toLowerCase() && !x.archived))
        throw bad(`"${name}" already exists`);
      // Insert after the last category of the same group (or at the end).
      const sameGroup = d.categories.filter((x) => x.kind === kind && x.group === group);
      const after = sameGroup.length ? Math.max(...sameGroup.map((x) => x.order)) : Math.max(-1, ...d.categories.map((x) => x.order));
      d.categories.push({ id: newId(), name, kind, group, order: after + 0.5 });
      renumber(d.categories);
    });
    mirror(c, y);
    return c.json({ year }, 201);
  })
  .patch('/:y/categories/:id', async (c) => {
    const y = yearParam(c.req.param('y'));
    const b = await body(c);
    const name = str(b, 'name', { optional: true });
    const group = str(b, 'group', { optional: true });
    const kind = oneOf(b, 'kind', KINDS, { optional: true });
    const archived = bool(b, 'archived');
    const { year } = await r(c).mutateYear(y, (d) => {
      const cat = findCat(d, c.req.param('id'));
      if (name) cat.name = name;
      if (kind) cat.kind = kind;
      if (archived !== undefined) cat.archived = archived || undefined;
      if (group && group !== cat.group) {
        // Move to the end of the target group.
        const target = d.categories.filter((x) => x.group === group && x.id !== cat.id);
        cat.group = group;
        if (target.length) cat.order = Math.max(...target.map((x) => x.order)) + 0.5;
        renumber(d.categories);
      }
    });
    mirror(c, y);
    return c.json({ year });
  })
  .post('/:y/categories/:id/move', async (c) => {
    const y = yearParam(c.req.param('y'));
    const dir = oneOf(await body(c), 'direction', ['up', 'down'] as const)!;
    const { year } = await r(c).mutateYear(y, (d) => {
      const cat = findCat(d, c.req.param('id'));
      const list = d.categories.filter((x) => x.kind === cat.kind).sort((a, b) => a.order - b.order);
      const i = list.indexOf(cat);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      const other = list[j]!;
      [cat.order, other.order] = [other.order, cat.order];
      // Crossing into another group moves the category into that group.
      if (other.group !== cat.group) cat.group = other.group;
    });
    mirror(c, y);
    return c.json({ year });
  })
  .delete('/:y/categories/:id', async (c) => {
    const y = yearParam(c.req.param('y'));
    const id = c.req.param('id');
    const data = await r(c).getYear(y);
    if (!data) throw notFound('Year');
    const used = MONTHS.some((m) => data.months[m]!.some((e) => e.categoryId === id)) || data.year.items.some((i) => i.categoryId === id);
    const { year } = await r(c).mutateYear(y, (d) => {
      const cat = findCat(d, id);
      if (used) cat.archived = true; // keep history
      else d.categories = d.categories.filter((x) => x.id !== id);
    });
    mirror(c, y);
    return c.json({ year, archived: used });
  })

  // ----- items (trips, purchases, …) -----
  .post('/:y/items', async (c) => {
    const y = yearParam(c.req.param('y'));
    const b = await body(c);
    const categoryId = str(b, 'categoryId')!;
    const name = str(b, 'name')!;
    const month = b.month === undefined || b.month === null ? undefined : monthParam(b.month);
    const { year, result: item } = await r(c).mutateYear(y, (d) => {
      findCat(d, categoryId);
      const it = { id: newId(), categoryId, name, month };
      d.items.push(it);
      return it;
    });
    mirror(c, y);
    return c.json({ year, item }, 201);
  })
  .patch('/:y/items/:id', async (c) => {
    const y = yearParam(c.req.param('y'));
    const b = await body(c);
    const name = str(b, 'name', { optional: true });
    const { year } = await r(c).mutateYear(y, (d) => {
      const it = findItem(d, c.req.param('id'));
      if (name) it.name = name;
      if (b.month !== undefined) it.month = b.month === null ? undefined : monthParam(b.month);
    });
    mirror(c, y);
    return c.json({ year });
  })
  .delete('/:y/items/:id', async (c) => {
    const y = yearParam(c.req.param('y'));
    const id = c.req.param('id');
    const data = await r(c).getYear(y);
    if (data && MONTHS.some((m) => data.months[m]!.some((e) => e.itemId === id)))
      throw new HTTPException(409, { message: 'This item has amounts. Delete or move them first.' });
    const { year } = await r(c).mutateYear(y, (d) => (d.items = d.items.filter((x) => x.id !== id)));
    mirror(c, y);
    return c.json({ year });
  })

  // ----- entries -----
  .post('/:y/months/:m/entries', async (c) => {
    const y = yearParam(c.req.param('y'));
    const m = monthParam(c.req.param('m'));
    const b = await body(c);
    const entry: Entry = {
      id: newId(),
      categoryId: str(b, 'categoryId')!,
      itemId: str(b, 'itemId', { optional: true }),
      amount: num(b, 'amount')!,
      note: str(b, 'note', { optional: true, max: 200 }),
    };
    if (entry.amount === 0) throw bad('amount cannot be 0');
    await checkRefs(c, y, entry);
    const { entries } = await r(c).mutateMonth(y, m, (list) => list.push(entry));
    mirror(c, y);
    return c.json({ months: { [m]: entries }, entry }, 201);
  })
  .patch('/:y/months/:m/entries/:id', async (c) => {
    const y = yearParam(c.req.param('y'));
    const m = monthParam(c.req.param('m'));
    const id = c.req.param('id');
    const b = await body(c);
    const target = b.month === undefined ? m : monthParam(b.month);
    const repo_ = r(c);

    let moved: Entry | undefined;
    const { entries } = await repo_.mutateMonth(y, m, (list) => {
      const e = list.find((x) => x.id === id);
      if (!e) throw notFound('Entry');
      if (b.categoryId !== undefined) e.categoryId = str(b, 'categoryId')!;
      if (b.itemId !== undefined) e.itemId = str(b, 'itemId', { optional: true });
      if (b.amount !== undefined) e.amount = num(b, 'amount')!;
      if (b.note !== undefined) e.note = str(b, 'note', { optional: true, max: 200 });
      if (target !== m) {
        list.splice(list.indexOf(e), 1);
        moved = e;
      }
      return e;
    });
    const months: Record<number, Entry[]> = { [m]: entries };
    if (moved) months[target] = (await repo_.mutateMonth(y, target, (list) => list.push(moved!))).entries;
    mirror(c, y);
    return c.json({ months });
  })
  .delete('/:y/months/:m/entries/:id', async (c) => {
    const y = yearParam(c.req.param('y'));
    const m = monthParam(c.req.param('m'));
    const id = c.req.param('id');
    const { entries } = await r(c).mutateMonth(y, m, (list) => {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
    });
    mirror(c, y);
    return c.json({ months: { [m]: entries } });
  })
  /** Replace the month's "Untraced" amounts with a single correction (from the monthly count). */
  .put('/:y/months/:m/untraced', async (c) => {
    const y = yearParam(c.req.param('y'));
    const m = monthParam(c.req.param('m'));
    const amount = num(await body(c), 'amount')!;
    const repo_ = r(c);
    // Find (or create) the untraced category.
    let doc = await repo_.getYearDoc(y);
    if (!doc) throw notFound('Year');
    let cat = doc.categories.find((x) => x.role === 'untraced' && !x.archived);
    if (!cat) {
      const res = await repo_.mutateYear(y, (d) => {
        const lastExpense = d.categories.filter((x) => x.kind === 'expense').sort((a, b) => b.order - a.order)[0];
        const created: Category = { id: newId(), name: 'Untraced', kind: 'expense', group: lastExpense?.group ?? 'Other', order: (lastExpense?.order ?? 0) + 0.5, role: 'untraced' };
        d.categories.push(created);
        renumber(d.categories);
        return created;
      });
      doc = res.year;
      cat = res.result;
    }
    const catId = cat.id;
    const { entries } = await repo_.mutateMonth(y, m, (list) => {
      const kept = list.filter((e) => e.categoryId !== catId);
      list.length = 0;
      list.push(...kept);
      if (amount !== 0) list.push({ id: newId(), categoryId: catId, amount, note: 'Monthly count correction' });
    });
    mirror(c, y);
    return c.json({ months: { [m]: entries }, year: doc });
  })

  // ----- monthly counts -----
  .put('/:y/counts/:m', async (c) => {
    const y = yearParam(c.req.param('y'));
    const m = monthParam(c.req.param('m'));
    const b = await body(c);
    const balances: Record<string, number> = {};
    if (!b.balances || typeof b.balances !== 'object') throw bad('balances required');
    for (const [k, v] of Object.entries(b.balances as Record<string, unknown>)) {
      if (v === null || v === '' || v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw bad('balances must be numbers');
      balances[k] = Math.round(v * 100) / 100;
    }
    const stocksValue = num(b, 'stocksValue', { optional: true });
    const { year } = await r(c).mutateYear(y, (d) => {
      if (!Object.keys(balances).length && stocksValue === undefined) delete d.counts[m];
      else d.counts[m] = { balances, stocksValue };
    });
    mirror(c, y);
    return c.json({ year });
  });

async function checkRefs(c: Context<AppEnv>, y: number, e: Entry) {
  const doc = await r(c).getYearDoc(y);
  if (!doc) throw notFound('Year');
  findCat(doc, e.categoryId);
  if (e.itemId && findItem(doc, e.itemId).categoryId !== e.categoryId) throw bad('item belongs to another category');
}
