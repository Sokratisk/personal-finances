// One-way mirror: app → Google Sheet. Each year becomes a tab laid out like a classic budget sheet
// (categories × months, with real formulas), plus a "Funds" tab. The app owns these tabs and rewrites
// them after every change; edits made in the sheet are overwritten.
import type { GoogleEnv } from './env.ts';
import { SCOPES, googleToken } from './firestore.ts';
import { type Account, type Category, type Entry, type Fund, type Item, MONTHS, round2 } from './model.ts';
import type { YearData } from './repo.ts';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const col = (m: number) => String.fromCharCode(66 + m); // month 1 → C … 12 → N
type Cell = string | number;

// ---------- layout ----------

const fmt = (n: number) => String(round2(Math.abs(n)));

/** "=42.2+53.88-16+B70" from numbers and cell references; a lone number stays a number. */
export function formula(terms: (number | string)[]): Cell {
  if (!terms.length) return '';
  if (terms.length === 1 && typeof terms[0] === 'number') return round2(terms[0]);
  return (
    '=' +
    terms
      .map((t, i) => {
        if (typeof t === 'string') return (i ? '+' : '') + t;
        return t < 0 ? `-${fmt(t)}` : (i ? '+' : '') + fmt(t);
      })
      .join('')
  );
}

type Row =
  | { t: 'header' }
  | { t: 'cat'; c: Category }
  | { t: 'incomeTotal' }
  | { t: 'opening' }
  | { t: 'blank' }
  | { t: 'expenseTotal' }
  | { t: 'beforeStocks' }
  | { t: 'result' }
  | { t: 'label'; text: string }
  | { t: 'account'; a: Account }
  | { t: 'accountsTotal' }
  | { t: 'stocksValue' }
  | { t: 'itemsHeader'; c: Category }
  | { t: 'item'; i: Item };

export function buildYearGrid({ year, months }: YearData, accounts: Account[]) {
  const entriesOf = (pred: (e: Entry) => boolean, m: number) => (months[m] ?? []).filter(pred);
  const hasEntries = (c: Category) => MONTHS.some((m) => entriesOf((e) => e.categoryId === c.id, m).length);
  const visible = year.categories
    .filter((c) => !c.archived || hasEntries(c))
    .sort((a, b) => a.order - b.order);
  const byKind = (k: Category['kind']) => visible.filter((c) => c.kind === k);

  // Which month each item's entries are in (null if spread over several months).
  const itemMonth = new Map<string, number | null>();
  for (const m of MONTHS) {
    for (const e of months[m] ?? []) {
      if (!e.itemId) continue;
      const prev = itemMonth.get(e.itemId);
      itemMonth.set(e.itemId, prev === undefined || prev === m ? m : null);
    }
  }

  // 1. Row structure
  const rows: Row[] = [{ t: 'header' }];
  for (const c of byKind('income')) rows.push({ t: 'cat', c });
  rows.push({ t: 'incomeTotal' }, { t: 'opening' }, { t: 'blank' });
  let lastGroup: string | null = null;
  for (const c of byKind('expense')) {
    if (lastGroup !== null && c.group !== lastGroup) rows.push({ t: 'blank' });
    rows.push({ t: 'cat', c });
    lastGroup = c.group;
  }
  rows.push({ t: 'blank' }, { t: 'expenseTotal' }, { t: 'blank' }, { t: 'beforeStocks' });
  for (const c of byKind('stocks')) rows.push({ t: 'cat', c });
  rows.push({ t: 'blank' }, { t: 'result' }, { t: 'blank' });
  const activeAccounts = accounts.filter(
    (a) => !a.archived || MONTHS.some((m) => year.counts[m]?.balances?.[a.id] !== undefined),
  );
  if (activeAccounts.length) {
    rows.push({ t: 'label', text: 'Accounts (monthly count)' });
    for (const a of [...activeAccounts].sort((x, y) => x.order - y.order)) rows.push({ t: 'account', a });
    rows.push({ t: 'accountsTotal' }, { t: 'stocksValue' }, { t: 'blank' });
  }
  for (const c of visible) {
    const items = year.items.filter((i) => i.categoryId === c.id);
    if (!items.length) continue;
    rows.push({ t: 'itemsHeader', c });
    for (const i of items) rows.push({ t: 'item', i });
    rows.push({ t: 'blank' });
  }

  // 2. Row numbers
  const rowOf = new Map<string, number>();
  rows.forEach((r, idx) => {
    const n = idx + 1;
    if (r.t === 'cat') rowOf.set(`cat:${r.c.id}`, n);
    else if (r.t === 'item') rowOf.set(`item:${r.i.id}`, n);
    else if (r.t === 'account') rowOf.set(`acc:${r.a.id}`, n);
    else rowOf.set(r.t, n);
  });
  const catRows = (k: Category['kind']) => byKind(k).map((c) => rowOf.get(`cat:${c.id}`)!);
  const span = (rs: number[], m: number) => (rs.length ? `SUM(${col(m)}${Math.min(...rs)}:${col(m)}${Math.max(...rs)})` : '0');
  const incomeRows = catRows('income');
  const expenseRows = catRows('expense');
  const stockRows = catRows('stocks');
  const accRows = activeAccounts.map((a) => rowOf.get(`acc:${a.id}`)!);

  // 3. Render
  const bold: number[] = [];
  const values: Cell[][] = rows.map((r, idx) => {
    const n = idx + 1;
    const line = (label: string, total: Cell, perMonth: (m: number) => Cell) => [label, total, ...MONTHS.map(perMonth)];
    const sumRow = `=SUM(C${n}:N${n})`;
    switch (r.t) {
      case 'header':
        bold.push(n);
        return ['', 'Total', ...MONTH_NAMES];
      case 'cat':
        return line(r.c.name, sumRow, (m) => {
          const terms: (number | string)[] = [];
          const refd = new Set<string>();
          for (const e of entriesOf((e) => e.categoryId === r.c.id, m)) {
            if (e.itemId && itemMonth.get(e.itemId) === m && rowOf.has(`item:${e.itemId}`)) {
              if (!refd.has(e.itemId)) terms.push(`B${rowOf.get(`item:${e.itemId}`)}`);
              refd.add(e.itemId);
            } else terms.push(e.amount);
          }
          return formula(terms);
        });
      case 'incomeTotal':
        bold.push(n);
        return line('Income', `=SUM(C${n}:N${n})`, (m) => `=${span(incomeRows, m)}`);
      case 'opening':
        return [`From ${year.year - 1}`, round2(year.opening)];
      case 'expenseTotal':
        bold.push(n);
        return line('Expenses', sumRow, (m) => `=${span(expenseRows, m)}`);
      case 'beforeStocks':
        return line('Before stocks', sumRow, (m) => `=${col(m)}${rowOf.get('incomeTotal')}-${col(m)}${rowOf.get('expenseTotal')}`);
      case 'result':
        bold.push(n);
        return line('Result', `=SUM(C${n}:N${n})+B${rowOf.get('opening')}`, (m) => {
          const before = `${col(m)}${rowOf.get('beforeStocks')}`;
          return stockRows.length ? `=${before}-${span(stockRows, m)}` : `=${before}`;
        });
      case 'label':
        bold.push(n);
        return [r.text];
      case 'account':
        return line(r.a.name, '', (m) => year.counts[m]?.balances?.[r.a.id] ?? '');
      case 'accountsTotal':
        bold.push(n);
        return line('Total', '', (m) => (year.counts[m] ? `=${span(accRows, m)}` : ''));
      case 'stocksValue':
        return line('Stocks value', '', (m) => year.counts[m]?.stocksValue ?? '');
      case 'itemsHeader': {
        bold.push(n);
        const its = year.items.filter((i) => i.categoryId === r.c.id).map((i) => rowOf.get(`item:${i.id}`)!);
        return [r.c.name, `=SUM(B${Math.min(...its)}:B${Math.max(...its)})`];
      }
      case 'item': {
        const terms = MONTHS.flatMap((m) => entriesOf((e) => e.itemId === r.i.id, m).map((e) => e.amount));
        return [r.i.name, formula(terms) || 0];
      }
      default:
        return [];
    }
  });
  return { values, bold };
}

export function buildFundsGrid(funds: Fund[]) {
  const values: Cell[][] = [];
  const bold: number[] = [];
  for (const f of [...funds].sort((a, b) => a.order - b.order)) {
    if (f.archived) continue;
    values.push([f.name, 'Amount', 'Date']);
    bold.push(values.length);
    const first = values.length + 1;
    for (const e of f.entries) values.push([e.note ?? '', round2(e.amount), e.date]);
    const last = values.length;
    values.push(['Remaining', last >= first ? `=SUM(B${first}:B${last})` : 0]);
    bold.push(values.length);
    values.push([]);
  }
  return { values, bold };
}

// ---------- Sheets API ----------

export function sheetsClient(env: GoogleEnv, spreadsheetId: string) {
  const base = `${API}/${encodeURIComponent(spreadsheetId)}`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await googleToken(env, [SCOPES.sheets]);
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 403 || res.status === 404)
        throw new Error('Cannot access the sheet. Check the ID and that it is shared (Editor) with the app email.');
      throw new Error(`Sheets API ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  type Meta = {
    properties: { locale: string };
    sheets: { properties: { sheetId: number; title: string; index: number } }[];
  };
  const batch = (requests: unknown[]) => call('POST', ':batchUpdate', { requests });

  /** Make sure a tab exists (creating it protected-with-warning), return its numeric id. */
  async function ensureTab(title: string): Promise<number> {
    const meta = await call<Meta>('GET', '?fields=properties.locale,sheets.properties(sheetId,title,index)');
    // Formulas are written with "." decimals (e.g. =42.2+16.5); comma-decimal locales (Greek, German…)
    // would reject them, so the app-managed spreadsheet uses English (UK) number formatting.
    if (!/^en/.test(meta.properties.locale)) {
      await batch([{ updateSpreadsheetProperties: { properties: { locale: 'en_GB' }, fields: 'locale' } }]);
    }
    const found = meta.sheets.find((s) => s.properties.title === title);
    if (found) return found.properties.sheetId;
    const res = await call<{ replies: { addSheet: { properties: { sheetId: number } } }[] }>('POST', ':batchUpdate', {
      requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } } } }],
    });
    const id = res.replies[0]!.addSheet.properties.sheetId;
    const requests: unknown[] = [
      { addProtectedRange: { protectedRange: { range: { sheetId: id }, warningOnly: true, description: 'Managed by the Personal Finances app — edits are overwritten.' } } },
    ];
    // Remove the empty default tab of a brand-new spreadsheet.
    const defaultTab = meta.sheets.find((s) => /^(Sheet1|Φύλλο1)$/.test(s.properties.title));
    if (defaultTab) requests.push({ deleteSheet: { sheetId: defaultTab.properties.sheetId } });
    await batch(requests);
    return id;
  }

  /** Replace a tab's contents with `values` and apply basic formatting. */
  async function writeTab(title: string, grid: { values: Cell[][]; bold: number[] }, numberCols: [number, number]) {
    const id = await ensureTab(title);
    const range = encodeURIComponent(`'${title}'`);
    await call('POST', `/values/${range}:clear`, {});
    await call('PUT', `/values/${range}!A1?valueInputOption=USER_ENTERED`, { values: grid.values });
    const rows = Math.max(grid.values.length, 1);
    await batch([
      {
        repeatCell: {
          range: { sheetId: id, startRowIndex: 0, endRowIndex: rows + 50, startColumnIndex: 0, endColumnIndex: 26 },
          cell: { userEnteredFormat: { textFormat: { bold: false } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      },
      {
        repeatCell: {
          range: { sheetId: id, startRowIndex: 0, endRowIndex: rows, startColumnIndex: numberCols[0], endColumnIndex: numberCols[1] },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      ...grid.bold.map((r) => ({
        repeatCell: {
          range: { sheetId: id, startRowIndex: r - 1, endRowIndex: r, startColumnIndex: 0, endColumnIndex: 14 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold',
        },
      })),
      {
        updateDimensionProperties: {
          range: { sheetId: id, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 200 },
          fields: 'pixelSize',
        },
      },
    ]);
  }

  return {
    syncYear: (data: YearData, accounts: Account[]) => writeTab(String(data.year.year), buildYearGrid(data, accounts), [1, 14]),
    syncFunds: (funds: Fund[]) => writeTab('Funds', buildFundsGrid(funds), [1, 2]),
  };
}
