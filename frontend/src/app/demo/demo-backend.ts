// In-memory stand-in for the Hono API, used in demo mode. Answers the same routes with the same
// response shapes, so the whole app works — but nothing leaves the browser and a reload resets it.
import { Injectable } from '@angular/core';
import { MONTHS, type Category, type Entry, type Kind, type YearDoc } from '../core/models';
import { createDemoState, type DemoState } from './demo-data';

export class DemoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Body = Record<string, unknown>;
type Handler = (params: string[], body: Body) => unknown;

const newId = () => Math.random().toString(36).slice(2, 12);
const r2 = (n: number) => Math.round(n * 100) / 100;
const clone = <T>(v: T): T => structuredClone(v);
const fail = (status: number, msg: string): never => {
  throw new DemoError(status, msg);
};
const today = () => new Date().toISOString().slice(0, 10);

@Injectable({ providedIn: 'root' })
export class DemoBackend {
  private state: DemoState = createDemoState();
  private readonly routes: [string, RegExp, Handler][] = [];

  /** Fresh data each time the demo starts. */
  reset() {
    this.state = createDemoState();
  }

  /** Handle one API call. `path` is relative to /api (e.g. "/years/2026"). */
  handle(method: string, path: string, body: unknown): unknown {
    for (const [m, re, h] of this.routes) {
      const match = method === m ? path.match(re) : null;
      if (match) return clone(h(match.slice(1), (body ?? {}) as Body));
    }
    return fail(404, 'Not found');
  }

  // ---------- helpers ----------
  private get p() {
    return this.state.profile;
  }
  private profileRes() {
    return { profile: this.p, serviceAccountEmail: null };
  }
  private yearData(y: number) {
    return this.state.years.get(y) ?? fail(404, 'Year not found');
  }
  private yearDoc(y: string) {
    return this.yearData(Number(y)).year;
  }
  private cat(doc: YearDoc, id: string) {
    return doc.categories.find((c) => c.id === id) ?? fail(404, 'Category not found');
  }
  private renumber(cats: Category[]) {
    [...cats].sort((a, b) => a.order - b.order).forEach((c, i) => (c.order = i));
  }
  private used(y: number, pred: (e: Entry) => boolean) {
    const d = this.yearData(y);
    return MONTHS.some((m) => (d.months[m] ?? []).some(pred));
  }
  private on(method: string, pattern: string, h: Handler) {
    this.routes.push([method, new RegExp(`^${pattern.replace(/:[a-z]+/g, '([^/]+)')}$`), h]);
  }

  constructor() {
    const syncOff = () => fail(400, 'Google Sheet sync is not available in the demo.');

    // ----- profile & settings -----
    this.on('GET', '/profile', () => this.profileRes());
    this.on('PUT', '/settings', syncOff);
    this.on('POST', '/sync', syncOff);

    this.on('GET', '/items', () => ({
      items: [...this.state.years.values()].flatMap(({ year, months }) =>
        year.items.map((it) => ({
          year: year.year,
          id: it.id,
          name: it.name,
          categoryId: it.categoryId,
          categoryName: year.categories.find((c) => c.id === it.categoryId)?.name ?? '',
          month: it.month,
          entries: MONTHS.flatMap((m) => (months[m] ?? []).filter((e) => e.itemId === it.id).map((e) => ({ id: e.id, month: m, amount: e.amount, note: e.note }))),
        })),
      ),
    }));

    // ----- accounts -----
    this.on('POST', '/accounts', (_, b) => {
      this.p.accounts.push({ id: newId(), name: String(b['name']), order: this.p.accounts.length });
      return this.profileRes();
    });
    this.on('PATCH', '/accounts/:id', ([id], b) => {
      const a = this.p.accounts.find((x) => x.id === id) ?? fail(404, 'Account not found');
      if (b['name']) a.name = String(b['name']);
      if (typeof b['archived'] === 'boolean') a.archived = b['archived'] || undefined;
      return this.profileRes();
    });
    this.on('POST', '/accounts/:id/move', ([id], b) => {
      const list = [...this.p.accounts].sort((a, c) => a.order - c.order);
      const i = list.findIndex((x) => x.id === id);
      const j = b['direction'] === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < list.length) [list[i]!.order, list[j]!.order] = [list[j]!.order, list[i]!.order];
      return this.profileRes();
    });

    // ----- funds -----
    this.on('POST', '/funds', (_, b) => {
      const initial = Number(b['initial']) || 0;
      this.p.funds.push({
        id: newId(),
        name: String(b['name']),
        order: this.p.funds.length,
        entries: initial ? [{ id: newId(), amount: initial, note: 'Initial amount', date: today() }] : [],
      });
      return this.profileRes();
    });
    this.on('PATCH', '/funds/:id', ([id], b) => {
      const f = this.p.funds.find((x) => x.id === id) ?? fail(404, 'Fund not found');
      if (b['name']) f.name = String(b['name']);
      if (typeof b['archived'] === 'boolean') f.archived = b['archived'] || undefined;
      return this.profileRes();
    });
    this.on('DELETE', '/funds/:id', ([id]) => {
      this.p.funds = this.p.funds.filter((f) => f.id !== id);
      return this.profileRes();
    });
    this.on('POST', '/funds/:id/entries', ([id], b) => {
      const f = this.p.funds.find((x) => x.id === id) ?? fail(404, 'Fund not found');
      f.entries.push({ id: newId(), amount: r2(Number(b['amount'])), note: (b['note'] as string) || undefined, date: (b['date'] as string) || today() });
      return this.profileRes();
    });
    this.on('DELETE', '/funds/:id/entries/:eid', ([id, eid]) => {
      const f = this.p.funds.find((x) => x.id === id) ?? fail(404, 'Fund not found');
      f.entries = f.entries.filter((e) => e.id !== eid);
      return this.profileRes();
    });

    // ----- years -----
    this.on('GET', '/years/:y', ([y]) => {
      const d = this.yearData(Number(y));
      return { ...d, prevDecember: this.state.years.get(Number(y) - 1)?.year.counts['12'] ?? null };
    });
    this.on('POST', '/years', (_, b) => {
      const year = Number(b['year']);
      if (this.state.years.has(year)) fail(409, `${year} already exists`);
      const src = b['copyFrom'] ? this.state.years.get(Number(b['copyFrom'])) : undefined;
      const ids = Array.isArray(b['categoryIds']) ? (b['categoryIds'] as string[]) : undefined;
      const categories = (src?.year.categories ?? []).filter((c) => (ids ? ids.includes(c.id) : !c.archived)).map((c) => ({ ...c, archived: undefined }));
      this.renumber(categories);
      const doc: YearDoc = { year, opening: Number(b['opening']) || 0, categories, items: [], counts: {} };
      this.state.years.set(year, { year: doc, months: Object.fromEntries(MONTHS.map((m) => [m, []])) });
      this.p.years = [...new Set([...this.p.years, year])].sort((a, c) => a - c);
      return { year: doc, ...this.profileRes() };
    });
    this.on('PATCH', '/years/:y', ([y], b) => {
      const doc = this.yearDoc(y!);
      doc.opening = r2(Number(b['opening']) || 0);
      return { year: doc };
    });

    // ----- categories -----
    this.on('POST', '/years/:y/categories', ([y], b) => {
      const doc = this.yearDoc(y!);
      const kind = b['kind'] as Kind;
      const group = (b['group'] as string) || (kind === 'expense' ? 'Other' : kind === 'income' ? 'Income' : 'Stocks');
      const same = doc.categories.filter((c) => c.kind === kind && c.group === group);
      const after = same.length ? Math.max(...same.map((c) => c.order)) : Math.max(-1, ...doc.categories.map((c) => c.order));
      doc.categories.push({ id: newId(), name: String(b['name']), kind, group, order: after + 0.5 });
      this.renumber(doc.categories);
      return { year: doc };
    });
    this.on('PATCH', '/years/:y/categories/:id', ([y, id], b) => {
      const doc = this.yearDoc(y!);
      const c = this.cat(doc, id!);
      if (b['name']) c.name = String(b['name']);
      if (typeof b['archived'] === 'boolean') c.archived = b['archived'] || undefined;
      if (b['group'] && b['group'] !== c.group) {
        const target = doc.categories.filter((x) => x.group === b['group'] && x.id !== c.id);
        c.group = String(b['group']);
        if (target.length) c.order = Math.max(...target.map((x) => x.order)) + 0.5;
        this.renumber(doc.categories);
      }
      return { year: doc };
    });
    this.on('POST', '/years/:y/categories/:id/move', ([y, id], b) => {
      const doc = this.yearDoc(y!);
      const c = this.cat(doc, id!);
      const list = doc.categories.filter((x) => x.kind === c.kind).sort((a, d) => a.order - d.order);
      const i = list.indexOf(c);
      const other = list[b['direction'] === 'up' ? i - 1 : i + 1];
      if (other) {
        [c.order, other.order] = [other.order, c.order];
        if (other.group !== c.group) c.group = other.group;
      }
      return { year: doc };
    });
    this.on('DELETE', '/years/:y/categories/:id', ([y, id]) => {
      const doc = this.yearDoc(y!);
      const c = this.cat(doc, id!);
      const archived = this.used(Number(y), (e) => e.categoryId === id) || doc.items.some((i) => i.categoryId === id);
      if (archived) c.archived = true;
      else doc.categories = doc.categories.filter((x) => x.id !== id);
      return { year: doc, archived };
    });

    // ----- items -----
    this.on('POST', '/years/:y/items', ([y], b) => {
      const doc = this.yearDoc(y!);
      this.cat(doc, String(b['categoryId']));
      doc.items.push({ id: newId(), categoryId: String(b['categoryId']), name: String(b['name']), month: b['month'] ? Number(b['month']) : undefined });
      return { year: doc };
    });
    this.on('PATCH', '/years/:y/items/:id', ([y, id], b) => {
      const it = this.yearDoc(y!).items.find((x) => x.id === id) ?? fail(404, 'Item not found');
      if (b['name']) it.name = String(b['name']);
      if (b['month'] !== undefined) it.month = b['month'] === null ? undefined : Number(b['month']);
      return { year: this.yearDoc(y!) };
    });
    this.on('DELETE', '/years/:y/items/:id', ([y, id]) => {
      if (this.used(Number(y), (e) => e.itemId === id)) fail(409, 'This item has amounts. Delete or move them first.');
      const doc = this.yearDoc(y!);
      doc.items = doc.items.filter((x) => x.id !== id);
      return { year: doc };
    });

    // ----- entries -----
    const month = (y: string, m: string) => {
      const d = this.yearData(Number(y));
      return (d.months[Number(m)] ??= []);
    };
    this.on('POST', '/years/:y/months/:m/entries', ([y, m], b) => {
      this.cat(this.yearDoc(y!), String(b['categoryId']));
      const entry: Entry = { id: newId(), categoryId: String(b['categoryId']), itemId: (b['itemId'] as string) || undefined, amount: r2(Number(b['amount'])), note: (b['note'] as string) || undefined };
      if (!entry.amount) fail(400, 'amount cannot be 0');
      month(y!, m!).push(entry);
      return { months: { [Number(m)]: month(y!, m!) }, entry };
    });
    this.on('PATCH', '/years/:y/months/:m/entries/:id', ([y, m, id], b) => {
      const list = month(y!, m!);
      const e = list.find((x) => x.id === id) ?? fail(404, 'Entry not found');
      if (b['categoryId'] !== undefined) e.categoryId = String(b['categoryId']);
      if (b['itemId'] !== undefined) e.itemId = (b['itemId'] as string) || undefined;
      if (b['amount'] !== undefined) e.amount = r2(Number(b['amount']));
      if (b['note'] !== undefined) e.note = (b['note'] as string) || undefined;
      const months: Record<number, Entry[]> = { [Number(m)]: list };
      const target = b['month'] === undefined ? Number(m) : Number(b['month']);
      if (target !== Number(m)) {
        list.splice(list.indexOf(e), 1);
        month(y!, String(target)).push(e);
        months[target] = month(y!, String(target));
      }
      return { months };
    });
    this.on('DELETE', '/years/:y/months/:m/entries/:id', ([y, m, id]) => {
      const list = month(y!, m!);
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
      return { months: { [Number(m)]: list } };
    });
    this.on('PUT', '/years/:y/months/:m/untraced', ([y, m], b) => {
      const doc = this.yearDoc(y!);
      let cat = doc.categories.find((c) => c.role === 'untraced' && !c.archived);
      if (!cat) {
        cat = { id: newId(), name: 'Untraced', kind: 'expense', group: 'Other', order: doc.categories.length, role: 'untraced' };
        doc.categories.push(cat);
      }
      const list = month(y!, m!);
      const kept = list.filter((e) => e.categoryId !== cat!.id);
      list.length = 0;
      list.push(...kept);
      const amount = r2(Number(b['amount']));
      if (amount) list.push({ id: newId(), categoryId: cat.id, amount, note: 'Monthly count correction' });
      return { months: { [Number(m)]: list }, year: doc };
    });

    // ----- monthly count -----
    this.on('PUT', '/years/:y/counts/:m', ([y, m], b) => {
      const doc = this.yearDoc(y!);
      const balances: Record<string, number> = {};
      for (const [k, v] of Object.entries((b['balances'] ?? {}) as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) balances[k] = r2(v);
      }
      const stocksValue = typeof b['stocksValue'] === 'number' ? r2(b['stocksValue']) : undefined;
      if (!Object.keys(balances).length && stocksValue === undefined) delete doc.counts[m!];
      else doc.counts[m!] = { balances, stocksValue };
      return { year: doc };
    });
  }
}
