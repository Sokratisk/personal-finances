// Imports a yearly budget workbook (one tab per year, months as columns) into the app.
//
//   node scripts/import-budget.ts <file.xlsx> [--dry-run] [--uid <firebase uid>] [--sheet <sheet id>]
//
// Layout it understands (labels in Greek, as in the original sheet):
//   income rows → "Εσοδα" total → "Από το YYYY" carry-over → expense rows (blank rows = groups)
//   → "Εξοδα" total → "Μετοχές" (stocks) → "Σύνολο" → "Λογαριασμοί/Μήνα:" account balances
//   → "Stocks Value" → item lists (e.g. trips/purchases referenced from month cells) and funds.
// Month cells like "=42.2+53.88-16" become one entry per term. Runs with Node 23+ (type stripping).
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import type { GoogleEnv } from '../src/env.ts';
import { SCOPES, googleToken } from '../src/firestore.ts';
import { type Account, type Category, type Entry, type Fund, type Item, type Kind, type YearDoc, MONTHS, emptyProfile, newId, round2 } from '../src/model.ts';
import { type YearData, repo } from '../src/repo.ts';
import { syncToSheet } from '../src/sync.ts';

// ---------- args / env ----------
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!file) {
  console.error('Usage: node scripts/import-budget.ts <file.xlsx> [--dry-run] [--uid <uid>] [--sheet <id>]');
  process.exit(1);
}
const here = new URL('../', import.meta.url);
const saJson = readFileSync(new URL('service-account.json', here), 'utf8');
const wrangler = readFileSync(new URL('wrangler.jsonc', here), 'utf8');
const env: GoogleEnv = {
  FIREBASE_SERVICE_ACCOUNT: saJson,
  FIREBASE_PROJECT_ID: wrangler.match(/"FIREBASE_PROJECT_ID":\s*"([^"]+)"/)![1]!,
  FIRESTORE_DATABASE: wrangler.match(/"FIRESTORE_DATABASE":\s*"([^"]+)"/)![1]!,
};

// ---------- cell helpers ----------
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
type CV = ExcelJS.CellValue;
const text = (v: CV): string => {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('').trim();
  return '';
};
const result = (v: CV): number | undefined => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in v && typeof v.result === 'number') return v.result;
  return undefined;
};
const formulaOf = (v: CV): string | undefined =>
  v && typeof v === 'object' && 'formula' in v && typeof v.formula === 'string' ? v.formula : undefined;

type Term = { amount: number } | { ref: string };
/** "42.2+53.88-16+B70" → terms; null if the formula isn't a plain sum. */
function parseTerms(f: string): Term[] | null {
  const s = f.replace(/\s+/g, '').replace(/^=/, '');
  const re = /([+-]?)(\d+(?:\.\d+)?|\$?[A-Z]{1,3}\$?\d+)/y;
  const out: Term[] = [];
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m || (pos > 0 && !m[1])) return null;
    const sign = m[1] === '-' ? -1 : 1;
    if (/^\d/.test(m[2]!)) out.push({ amount: sign * Number(m[2]) });
    else if (sign === 1) out.push({ ref: m[2]!.replace(/\$/g, '') });
    else return null;
    pos = re.lastIndex;
  }
  return out.length ? out : null;
}

/** Entries for one cell: split into terms when the sum checks out, else one entry with the value. */
function cellTerms(v: CV): Term[] {
  const val = result(v);
  const f = formulaOf(v);
  if (f) {
    const terms = parseTerms(f);
    if (terms) return terms;
  }
  if (val === undefined || Math.abs(val) < 0.005) return [];
  return [{ amount: val }];
}

// ---------- group naming ----------
const GROUP_RULES: [string, string[]][] = [
  ['Bills', ['ενοικιο', 'ρευμα', 'νερο', 'τηλεφωνια', 'δανικα', 'iris']],
  ['Home & food', ['groceries', 'σπιτι', 'κηπος', 'αγορες', 'e-food', 'δοσεις']],
  ['Work & subscriptions', ['γραφει', 'συνδρομες', 'web infra']],
  ['Taxes & credit', ['εφορια', 'πιστωτικη']],
  ['Vehicles', ['αυτοκινητο', 'καυσιμα', 'μηχανη', 'ξυλα']],
  ['Personal & hobbies', ['ξιφασκια', 'ενδυση', 'gimli', 'βιβλια', 'βολευ', 'στοιχημα', 'pc', 'πιανο', 'φωνητικη', 'ιστιοπλοια', 'δωρα']],
  ['Trips & going out', ['ταξιδια', 'εξοδοι']],
  ['Health & other', ['φαρμακειο', 'ιατρικα', 'διαφορα', 'untraced', 'φακοι']],
];
const ruleGroup = (name: string) => GROUP_RULES.find(([, keys]) => keys.some((k) => norm(name).includes(k)))?.[0];

// ---------- import ----------
const catIds = new Map<string, string>(); // `${kind}:${norm name}` → id (stable across years)
const groupOf = new Map<string, string>(); // norm name → group (latest year wins)
const accounts: Account[] = [];
const accountId = (name: string) => {
  let a = accounts.find((x) => norm(x.name) === norm(name));
  if (!a) accounts.push((a = { id: newId(), name: name.trim(), order: accounts.length }));
  return a.id;
};
let funds: Fund[] | undefined;
const warnings: string[] = [];

function importSheet(ws: ExcelJS.Worksheet): { data: YearData; check: { income: number[]; expenses: number[] } } {
  const year = Number(ws.name);
  const doc: YearDoc = { year, opening: 0, categories: [], items: [], counts: {} };
  const months: Record<number, Entry[]> = Object.fromEntries(MONTHS.map((m) => [m, []]));
  const cell = (r: number, c: number) => ws.getRow(r).getCell(c).value;
  const label = (r: number) => text(cell(r, 1));

  type RowCat = { row: number; cat: Category; chunk: number };
  const rowCats: RowCat[] = [];
  const check = { income: [] as number[], expenses: [] as number[] };
  let mode: 'income' | 'expense' | 'stocks' | 'accounts' | 'accountsDone' | 'after' | 'lists' = 'income';
  let chunk = 0;
  let stocksInsideExpenses = false;
  let listsStart = 0;

  const addCat = (row: number, name: string, kind: Kind) => {
    const key = `${kind}:${norm(name)}`;
    if (!catIds.has(key)) catIds.set(key, newId());
    const cat: Category = { id: catIds.get(key)!, name: name.trim(), kind, group: kind === 'income' ? 'Income' : kind === 'stocks' ? 'Stocks' : '', order: 0 };
    if (norm(name) === 'untraced') cat.role = 'untraced';
    rowCats.push({ row, cat, chunk });
  };

  for (let r = 2; r <= ws.rowCount; r++) {
    const l = label(r);
    const n = norm(l);
    if (!l) {
      if (mode === 'expense') chunk++;
      if (mode === 'after' && r > 2) continue;
      continue;
    }
    if (mode === 'income') {
      if (n === 'εσοδα') {
        check.income = MONTHS.map((m) => result(cell(r, m + 2)) ?? 0);
        continue;
      }
      if (/^απο το \d{4}/.test(n)) {
        doc.opening = result(cell(r, 2)) ?? 0;
        mode = 'expense';
        continue;
      }
      if (check.income.length) {
        mode = 'expense'; // no carry-over row this year
      } else {
        addCat(r, l, 'income');
        continue;
      }
    }
    if (mode === 'expense') {
      if (n === 'εξοδα') {
        check.expenses = MONTHS.map((m) => result(cell(r, m + 2)) ?? 0);
        mode = 'stocks';
        continue;
      }
      if (n.includes('ετοχ')) {
        stocksInsideExpenses = true;
        addCat(r, l, 'stocks');
        continue;
      }
      addCat(r, l, 'expense');
      continue;
    }
    if (mode === 'stocks') {
      if (n.startsWith('διαφορα')) continue; // "Διαφορά προ Μετοχών" is a computed row, not a category
      if (n.includes('ετοχ')) addCat(r, l, 'stocks');
      else if (n === 'συνολο') mode = 'after';
      continue;
    }
    if (mode === 'after') {
      if (n.startsWith('λογαριασμοι')) mode = 'accounts';
      continue;
    }
    if (mode === 'accounts' || mode === 'accountsDone') {
      if (n === 'συνολο') {
        mode = 'accountsDone'; // accounts end at their total row
        continue;
      }
      if (n === 'stocks value') {
        for (const m of MONTHS) {
          const v = result(cell(r, m + 2));
          if (v !== undefined) (doc.counts[m] ??= { balances: {} }).stocksValue = round2(v);
        }
        listsStart = r + 1;
        mode = 'lists';
        continue;
      }
      if (mode === 'accountsDone') {
        // Anything else after the total (e.g. loans in 2024) starts the lists area.
        listsStart = r;
        mode = 'lists';
        continue;
      }
      const id = accountId(l);
      for (const m of MONTHS) {
        const v = result(cell(r, m + 2));
        if (v !== undefined) (doc.counts[m] ??= { balances: {} }).balances[id] = round2(v);
      }
      continue;
    }
  }
  if (!listsStart) listsStart = ws.rowCount + 1;

  // Item lists: a header cell whose name matches an expense category and whose neighbour is a SUM.
  const itemAt = new Map<string, Item & { terms: Term[] }>(); // "B70" → item
  const expenseCats = rowCats.filter((x) => x.cat.kind === 'expense');
  for (let r = listsStart; r <= ws.rowCount; r++) {
    for (const c of [1, 4, 7, 10]) {
      const name = text(cell(r, c));
      const f = formulaOf(cell(r, c + 1));
      if (!name || !f?.toUpperCase().startsWith('SUM(')) continue;
      const owner = expenseCats.find((x) => norm(x.cat.name) === norm(name));
      if (!owner) continue;
      let start = r + 1;
      while (start <= ws.rowCount && !text(cell(start, c))) start++; // blank rows under the header
      for (let rr = start; rr <= ws.rowCount; rr++) {
        const itemName = text(cell(rr, c));
        if (!itemName) break;
        const valueCell = cell(rr, c + 1);
        if (result(valueCell) === undefined && typeof valueCell !== 'number') break;
        const item = { id: newId(), categoryId: owner.cat.id, name: itemName, terms: cellTerms(valueCell) };
        itemAt.set(`${String.fromCharCode(64 + c + 1)}${rr}`, item);
      }
    }
  }

  // Funds (standalone pots) — taken from the newest sheet that has them.
  if (!funds) {
    const found: Fund[] = [];
    for (let r = listsStart; r <= ws.rowCount; r++) {
      for (const c of [1, 4, 7, 10]) {
        const name = text(cell(r, c));
        const v = cell(r, c + 1);
        const f = formulaOf(v);
        if (!name) continue;
        if (norm(name).startsWith('σκλαβενιτης')) {
          const terms = cellTerms(v).filter((t): t is { amount: number } => 'amount' in t);
          found.push({ id: newId(), name: name.trim(), order: found.length, entries: terms.map((t) => ({ id: newId(), amount: t.amount, note: t.amount > 0 ? 'Top-up' : 'Spent', date: `${year}-01-01` })) });
        }
        const rem = f?.replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)-SUM\(([A-Z])(\d+):([A-Z])(\d+)\)$/i);
        if (norm(name) === 'υπολοιπο' && rem) {
          const entries = [{ id: newId(), amount: Number(rem[1]), note: 'Budget', date: `${year}-01-01` }];
          for (let rr = Number(rem[3]); rr <= Number(rem[5]); rr++) {
            const costName = text(cell(rr, c));
            const val = result(cell(rr, c + 1)) ?? (typeof cell(rr, c + 1) === 'number' ? (cell(rr, c + 1) as number) : undefined);
            if (costName && val) entries.push({ id: newId(), amount: -val, note: costName, date: `${year}-01-01` });
          }
          found.push({ id: newId(), name: 'House purchase', order: found.length, entries });
        }
      }
    }
    if (found.length) funds = found;
  }

  // Month cells → entries
  const referenced = new Set<string>();
  for (const { row, cat } of rowCats) {
    for (const m of MONTHS) {
      const v = cell(row, m + 2);
      const terms = cellTerms(v);
      let sum = 0;
      for (const t of terms) {
        if ('amount' in t) {
          if (Math.abs(t.amount) >= 0.005) months[m]!.push({ id: newId(), categoryId: cat.id, amount: round2(t.amount) });
          sum += t.amount;
          continue;
        }
        const item = itemAt.get(t.ref);
        if (item) {
          referenced.add(t.ref);
          item.categoryId = cat.id;
          item.month ??= m;
          for (const it of item.terms) {
            if ('amount' in it && Math.abs(it.amount) >= 0.005) {
              months[m]!.push({ id: newId(), categoryId: cat.id, itemId: item.id, amount: round2(it.amount) });
              sum += it.amount;
            }
          }
        } else {
          // Reference to some other cell: keep its value as a single entry.
          const [, cl, rw] = t.ref.match(/^([A-Z]+)(\d+)$/)!;
          const colNum = cl!.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
          const val = result(cell(Number(rw), colNum)) ?? 0;
          if (val) months[m]!.push({ id: newId(), categoryId: cat.id, amount: round2(val), note: `from ${t.ref}` });
          sum += val;
        }
      }
      const expected = result(v) ?? (typeof v === 'number' ? v : undefined);
      if (expected !== undefined && Math.abs(expected - sum) > 0.01)
        warnings.push(`${year} ${cat.name} m${m}: parsed ${round2(sum)} ≠ sheet ${round2(expected)}`);
    }
  }
  // Items whose amounts were copied into a month cell instead of referenced: find their exact
  // amount sequence among that category's plain entries and tag those entries with the item.
  for (const [ref, item] of itemAt) {
    if (referenced.has(ref)) continue;
    const seq = item.terms.filter((t): t is { amount: number } => 'amount' in t && Math.abs(t.amount) >= 0.005).map((t) => round2(t.amount));
    let linked = false;
    for (const m of MONTHS) {
      if (!seq.length || linked) break;
      const list = months[m]!.filter((e) => e.categoryId === item.categoryId && !e.itemId);
      for (let i = 0; i + seq.length <= list.length; i++) {
        if (seq.every((a, k) => list[i + k]!.amount === a)) {
          for (let k = 0; k < seq.length; k++) list[i + k]!.itemId = item.id;
          item.month = m;
          referenced.add(ref);
          linked = true;
          break;
        }
      }
    }
    if (!linked) warnings.push(`${year}: item "${item.name}" (${ref}) could not be matched to a month — skipped`);
  }
  doc.items = [...itemAt.entries()].filter(([ref]) => referenced.has(ref)).map(([, { terms: _t, ...it }]) => it);

  // Groups: reuse the group a category had in a newer year; otherwise name the blank-row chunk.
  const chunks = new Map<number, RowCat[]>();
  for (const rc of rowCats.filter((x) => x.cat.kind === 'expense')) chunks.set(rc.chunk, [...(chunks.get(rc.chunk) ?? []), rc]);
  for (const list of chunks.values()) {
    const votes = new Map<string, number>();
    for (const { cat } of list) {
      const g = groupOf.get(norm(cat.name)) ?? ruleGroup(cat.name);
      if (g) votes.set(g, (votes.get(g) ?? 0) + 1);
    }
    const chunkGroup = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other';
    for (const { cat } of list) cat.group = groupOf.get(norm(cat.name)) ?? chunkGroup;
  }

  // Order: income, expenses by group (in sheet order of first appearance), stocks.
  const expense = rowCats.filter((x) => x.cat.kind === 'expense').map((x) => x.cat);
  const groupOrder = [...new Set(expense.map((c) => c.group))];
  const ordered = [
    ...rowCats.filter((x) => x.cat.kind === 'income').map((x) => x.cat),
    ...groupOrder.flatMap((g) => expense.filter((c) => c.group === g)),
    ...rowCats.filter((x) => x.cat.kind === 'stocks').map((x) => x.cat),
  ];
  ordered.forEach((c, i) => {
    c.order = i;
    const used = MONTHS.some((m) => months[m]!.some((e) => e.categoryId === c.id));
    if (!used) c.archived = true; // empty this year → hidden but kept
  });
  doc.categories = ordered;
  for (const c of expense) if (!groupOf.has(norm(c.name))) groupOf.set(norm(c.name), c.group);

  if (stocksInsideExpenses) {
    // The sheet counted stocks inside "Εξοδα" that year; compare like for like.
    const stockIds = new Set(ordered.filter((c) => c.kind === 'stocks').map((c) => c.id));
    check.expenses = check.expenses.map((v, i) => v - months[i + 1]!.filter((e) => stockIds.has(e.categoryId)).reduce((s, e) => s + e.amount, 0));
  }
  return { data: { year: doc, months }, check };
}

// ---------- run ----------
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const sheets = wb.worksheets.filter((w) => /^\d{4}$/.test(w.name)).sort((a, b) => Number(b.name) - Number(a.name));
const imported: YearData[] = [];

for (const ws of sheets) {
  const { data, check } = importSheet(ws);
  imported.push(data);
  const kindOf = new Map(data.year.categories.map((c) => [c.id, c.kind]));
  const total = (k: Kind, m: number) => round2(data.months[m]!.filter((e) => kindOf.get(e.categoryId) === k).reduce((s, e) => s + e.amount, 0));
  const entries = MONTHS.reduce((s, m) => s + data.months[m]!.length, 0);
  console.log(`\n${ws.name}: ${data.year.categories.filter((c) => !c.archived).length} categories (+${data.year.categories.filter((c) => c.archived).length} unused), ${data.year.items.length} items, ${entries} entries, ${Object.keys(data.year.counts).length} monthly counts, opening ${data.year.opening}`);
  let ok = true;
  for (const m of MONTHS) {
    const inc = total('income', m);
    const exp = total('expense', m);
    const ci = round2(check.income[m - 1] ?? 0);
    const ce = round2(check.expenses[m - 1] ?? 0);
    if (Math.abs(inc - ci) > 0.01 || Math.abs(exp - ce) > 0.01) {
      ok = false;
      console.log(`  ✗ month ${m}: income ${inc} vs sheet ${ci}, expenses ${exp} vs sheet ${ce}`);
    }
  }
  if (ok) console.log('  ✓ every month matches the sheet totals (income and expenses)');
}
imported.sort((a, b) => a.year.year - b.year.year);
if (warnings.length) console.log(`\nWarnings:\n  ${warnings.join('\n  ')}`);
console.log(`\nAccounts: ${accounts.map((a) => a.name).join(', ')}`);
console.log(`Funds: ${(funds ?? []).map((f) => `${f.name} (${round2(f.entries.reduce((s, e) => s + e.amount, 0))})`).join(', ') || 'none'}`);
console.log('Groups:', [...new Set(imported.at(-1)!.year.categories.filter((c) => c.kind === 'expense').map((c) => c.group))].join(' | '));

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// Find the user to import for (the only Firebase Auth user unless --uid is given).
let uid = flag('--uid');
if (!uid) {
  const token = await googleToken(env, [SCOPES.identity]);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:batchGet?maxResults=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const users = ((await res.json()) as { users?: { localId: string; email?: string }[] }).users ?? [];
  if (users.length !== 1) {
    console.error(`Found ${users.length} users — pass --uid <uid>.`);
    process.exit(1);
  }
  uid = users[0]!.localId;
  console.log(`\nImporting for ${users[0]!.email ?? uid}`);
}

const r = repo(env, uid);
const removed = await r.deleteLegacyTransactions();
if (removed) console.log(`Removed ${removed} transactions from the old app version.`);
for (const data of imported) await r.putYear(data);
const existing = await r.getProfile();
const profile = {
  ...emptyProfile(),
  ...existing,
  years: imported.map((d) => d.year.year),
  accounts,
  funds: funds ?? [],
  sheetId: flag('--sheet') ?? existing.sheetId,
};
await r.putProfile(profile);
console.log(`Wrote ${imported.length} years, ${accounts.length} accounts, ${profile.funds.length} funds.`);

if (profile.sheetId) {
  console.log('Mirroring to the Google Sheet…');
  const res = await syncToSheet(env, uid, { all: true }, profile);
  console.log(res?.ok ? '✓ Sheet updated' : `✗ Sheet sync failed: ${res?.error}`);
}
