// Mirrors backend/src/model.ts (the API's data shapes).

export type Kind = 'income' | 'expense' | 'stocks';

export interface Category {
  id: string;
  name: string;
  kind: Kind;
  group: string;
  order: number;
  archived?: boolean;
  role?: 'untraced';
}

export interface Item {
  id: string;
  categoryId: string;
  name: string;
  month?: number;
}

export interface Count {
  balances: Record<string, number>;
  stocksValue?: number;
}

export interface YearDoc {
  year: number;
  opening: number;
  categories: Category[];
  items: Item[];
  counts: Record<string, Count>;
}

export interface Entry {
  id: string;
  categoryId: string;
  itemId?: string;
  amount: number;
  note?: string;
}

export interface YearData {
  year: YearDoc;
  months: Record<number, Entry[]>;
  /** Previous year's December count (for January's untraced suggestion). */
  prevDecember?: Count | null;
}

export interface Account {
  id: string;
  name: string;
  order: number;
  archived?: boolean;
}

export interface FundEntry {
  id: string;
  amount: number;
  note?: string;
  date: string;
}

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
  sheetId?: string;
  lastSync?: { at: string; ok: boolean; error?: string };
}

/** An item (trip, purchase…) with its amounts, from any year (GET /api/items). */
export interface ItemSummary {
  year: number;
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  month?: number;
  entries: { id: string; month: number; amount: number; note?: string }[];
}

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const KIND_LABEL: Record<Kind, string> = { income: 'Income', expense: 'Expense', stocks: 'Stocks' };
