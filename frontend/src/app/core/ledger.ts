// Pure calculations over a year's data (same rules as the original budget sheet).
import { type Category, type Count, type Entry, type Kind, type YearData, MONTHS } from './models';

export const round2 = (n: number) => Math.round(n * 100) / 100;
const zeros = () => Array<number>(13).fill(0); // index 1..12

export interface Totals {
  /** categoryId → [_, jan … dec] */
  byCategory: Map<string, number[]>;
  income: number[];
  expenses: number[];
  stocks: number[];
  /** income − expenses */
  beforeStocks: number[];
  /** income − expenses − stocks */
  result: number[];
  untraced: number[];
  year: { income: number; expenses: number; stocks: number; result: number; final: number };
}

export function computeTotals(data: YearData): Totals {
  const cats = new Map(data.year.categories.map((c) => [c.id, c]));
  const byCategory = new Map<string, number[]>();
  const t: Record<Kind, number[]> = { income: zeros(), expense: zeros(), stocks: zeros() };
  const untraced = zeros();

  for (const m of MONTHS) {
    for (const e of data.months[m] ?? []) {
      const c = cats.get(e.categoryId);
      if (!c) continue;
      const row = byCategory.get(c.id) ?? zeros();
      row[m] = row[m]! + e.amount;
      byCategory.set(c.id, row);
      t[c.kind][m] = t[c.kind][m]! + e.amount;
      if (c.role === 'untraced') untraced[m] = untraced[m]! + e.amount;
    }
  }
  const beforeStocks = MONTHS.reduce((a, m) => ((a[m] = t.income[m]! - t.expense[m]!), a), zeros());
  const result = MONTHS.reduce((a, m) => ((a[m] = beforeStocks[m]! - t.stocks[m]!), a), zeros());
  const sum = (a: number[]) => round2(a.reduce((s, v) => s + v, 0));
  return {
    byCategory,
    income: t.income,
    expenses: t.expense,
    stocks: t.stocks,
    beforeStocks,
    result,
    untraced,
    year: {
      income: sum(t.income),
      expenses: sum(t.expense),
      stocks: sum(t.stocks),
      result: sum(result),
      final: round2(sum(result) + data.year.opening),
    },
  };
}

export const rowTotal = (row: number[] | undefined) => round2((row ?? []).reduce((s, v) => s + v, 0));

export function countTotal(c: Count | undefined): number | undefined {
  if (!c || !Object.keys(c.balances ?? {}).length) return undefined;
  return round2(Object.values(c.balances).reduce((s, v) => s + v, 0));
}

/**
 * Suggested "Untraced" correction for a month: what the recorded numbers say should have changed
 * (result, excluding any existing untraced) minus what the counts actually changed by.
 * Positive = money is missing (an expense).
 */
export function untracedSuggestion(data: YearData, totals: Totals, m: number) {
  const now = countTotal(data.year.counts[m]);
  const prev = m > 1 ? countTotal(data.year.counts[m - 1]) : undefined;
  if (now === undefined || prev === undefined) return null;
  const recorded = totals.result[m]! + totals.untraced[m]!;
  const counted = now - prev;
  return { now, prev, counted: round2(counted), recorded: round2(recorded), suggestion: round2(recorded - counted), current: round2(totals.untraced[m]!) };
}

/** Categories that should appear for a year: active ones, plus archived ones that have amounts. */
export function visibleCategories(data: YearData, totals: Totals): Category[] {
  return [...data.year.categories]
    .filter((c) => !c.archived || (totals.byCategory.get(c.id) ?? []).some((v) => Math.abs(v) > 0.001))
    .sort((a, b) => a.order - b.order);
}

/** Expense categories grouped in display order. */
export function groupExpenses(cats: Category[]): { group: string; categories: Category[] }[] {
  const out: { group: string; categories: Category[] }[] = [];
  for (const c of cats.filter((x) => x.kind === 'expense')) {
    const last = out.at(-1);
    if (last && last.group === c.group) last.categories.push(c);
    else out.push({ group: c.group, categories: [c] });
  }
  return out;
}

export function entriesFor(data: YearData, categoryId: string, m: number): Entry[] {
  return (data.months[m] ?? []).filter((e) => e.categoryId === categoryId);
}
