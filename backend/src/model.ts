// Data model. Stored in Firestore as:
//   users/{uid}                          → Profile  (accounts, funds, settings, list of years)
//   users/{uid}/years/{year}             → YearDoc  (categories, items, monthly counts, opening balance)
//   users/{uid}/years/{year}/months/{m}  → MonthDoc (all entries of that month)
// Grouping this way keeps a whole year at ~13 document reads.

export type Kind = 'income' | 'expense' | 'stocks';

export interface Category {
  id: string;
  name: string;
  kind: Kind;
  /** Display group, e.g. "Bills". Groups are shown in order of their first category. */
  group: string;
  order: number;
  archived?: boolean;
  /** The category used for the monthly "missing money" correction. */
  role?: 'untraced';
}

/** A named sub-item of a category, e.g. a trip under "Trips" or a purchase under "Purchases". */
export interface Item {
  id: string;
  categoryId: string;
  name: string;
  /** Month new entries default to. */
  month?: number;
}

/** Monthly counting of real balances. */
export interface Count {
  balances: Record<string, number>; // accountId → balance
  stocksValue?: number;
}

export interface YearDoc {
  year: number;
  /** Money carried over from the previous year. */
  opening: number;
  categories: Category[];
  items: Item[];
  counts: Record<string, Count>; // "1".."12"
}

/** One amount in a month. Amounts are as typed: positive normally, negative for refunds/splits. */
export interface Entry {
  id: string;
  categoryId: string;
  itemId?: string;
  amount: number;
  note?: string;
}

export interface MonthDoc {
  entries: Entry[];
}

export interface Account {
  id: string;
  name: string;
  order: number;
  archived?: boolean;
}

export interface FundEntry {
  id: string;
  amount: number; // + money in, − money out
  note?: string;
  date: string; // yyyy-mm-dd
}

/** Standalone pot of money outside the monthly cash flow (e.g. house budget, a gift card). */
export interface Fund {
  id: string;
  name: string;
  order: number;
  archived?: boolean;
  entries: FundEntry[];
}

export interface Profile {
  years: number[];
  accounts: Account[];
  funds: Fund[];
  /** Google Sheet the app mirrors into (optional, per user). */
  sheetId?: string;
  lastSync?: { at: string; ok: boolean; error?: string };
}

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const emptyProfile = (): Profile => ({ years: [], accounts: [], funds: [] });
export const emptyYear = (year: number): YearDoc => ({ year, opening: 0, categories: [], items: [], counts: {} });

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
export const round2 = (n: number) => Math.round(n * 100) / 100;
