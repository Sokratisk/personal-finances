import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService, type MonthsResponse, type ProfileResponse, type YearResponse } from './api.service';
import { computeTotals, countTotal, groupExpenses, untracedSuggestion, visibleCategories } from './ledger';
import type { Entry, Profile, YearData } from './models';

/** A counted month whose untraced no longer matches after its amounts changed. */
export interface UntracedPrompt {
  year: number;
  month: number;
  from: number;
  to: number;
}

/**
 * App state: the user's profile (years, accounts, funds, settings) and the selected year's data.
 * Every mutation goes through the API, which returns the changed document; we swap it in.
 */
@Injectable({ providedIn: 'root' })
export class FinanceStore {
  private readonly api = inject(ApiService);

  readonly profile = signal<Profile | null>(null);
  readonly serviceAccountEmail = signal<string | null>(null);
  readonly selectedYear = signal<number | null>(null);
  readonly data = signal<YearData | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly years = computed(() => this.profile()?.years ?? []);
  readonly accounts = computed(() => [...(this.profile()?.accounts ?? [])].sort((a, b) => a.order - b.order));
  readonly activeAccounts = computed(() => this.accounts().filter((a) => !a.archived));
  readonly funds = computed(() => [...(this.profile()?.funds ?? [])].sort((a, b) => a.order - b.order));

  readonly totals = computed(() => {
    const d = this.data();
    return d ? computeTotals(d) : null;
  });
  readonly categories = computed(() => {
    const d = this.data();
    const t = this.totals();
    return d && t ? visibleCategories(d, t) : [];
  });
  readonly activeCategories = computed(() => this.categories().filter((c) => !c.archived));
  readonly expenseGroups = computed(() => groupExpenses(this.categories()));
  readonly groupNames = computed(() => [...new Set((this.data()?.year.categories ?? []).filter((c) => c.kind === 'expense').map((c) => c.group))]);
  readonly items = computed(() => this.data()?.year.items ?? []);

  /** Latest month of the open year that has a saved count (0 if none). A saved count closes its month. */
  readonly lastClosedMonth = computed(() => {
    const counts = this.data()?.year.counts ?? {};
    return Math.max(0, ...Object.keys(counts).map(Number).filter((m) => countTotal(counts[m]) !== undefined));
  });
  /** The open year's calendar month today (12 for past years, 1 for future ones). */
  readonly calendarMonth = computed(() => {
    const y = this.data()?.year.year;
    const now = new Date();
    if (!y || y === now.getFullYear()) return now.getMonth() + 1;
    return y < now.getFullYear() ? 12 : 1;
  });
  /**
   * Where new amounts go by default: the later of today's month and the month after the last count.
   * Counting November on the 28th makes December active straight away.
   */
  readonly activeMonth = computed(() => Math.min(12, Math.max(this.calendarMonth(), this.lastClosedMonth() + 1)));
  /** December has been counted: the year is finished. */
  readonly yearClosed = computed(() => this.lastClosedMonth() === 12);

  private loadedFor: string | null = null;

  /** Load profile + the current (or latest) year once per signed-in user. */
  async init(uid: string) {
    if (this.loadedFor === uid) return;
    this.loadedFor = uid;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.applyProfile(await this.api.profile());
      const years = this.years();
      const now = new Date().getFullYear();
      const pick = years.includes(now) ? now : years.at(-1);
      if (pick) await this.selectYear(pick);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  reset() {
    this.loadedFor = null;
    this.profile.set(null);
    this.data.set(null);
    this.selectedYear.set(null);
  }

  async selectYear(y: number) {
    this.selectedYear.set(y);
    this.loading.set(true);
    try {
      this.data.set(await this.api.year(y));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** The year whose data is loaded (throws if none — callers only run with a year open). */
  get y(): number {
    const y = this.data()?.year.year;
    if (!y) throw new Error('No year selected');
    return y;
  }

  // ----- favourites -----
  readonly favoriteCategories = computed(() => new Set(this.profile()?.favoriteCategories ?? []));
  readonly favoriteItems = computed(() => new Set(this.profile()?.favoriteItems ?? []));

  /** Star / unstar a category or an item (trip). Saved on the profile, so it follows the user to every device. */
  async toggleFavorite(kind: 'category' | 'item', id: string) {
    const cats = new Set(this.favoriteCategories());
    const items = new Set(this.favoriteItems());
    const set = kind === 'category' ? cats : items;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.applyProfile(await this.api.saveFavorites({ categories: [...cats], items: [...items] }));
  }

  // ----- apply API responses -----
  applyProfile(r: ProfileResponse) {
    this.profile.set(r.profile);
    this.serviceAccountEmail.set(r.serviceAccountEmail);
  }
  applyYear(r: YearResponse) {
    this.data.update((d) => (d && d.year.year === r.year.year ? { ...d, year: r.year } : d));
  }
  applyMonths(r: MonthsResponse) {
    const before = this.data();
    this.data.update((d) => (d ? { ...d, year: r.year ?? d.year, months: { ...d.months, ...r.months } } : d));
    this.checkCountedMonths(before, Object.keys(r.months).map(Number));
  }

  // ----- keep counted months consistent -----
  /** Queue of counted months to offer an untraced update for (shown by <app-untraced-prompt>). */
  readonly untracedPrompts = signal<UntracedPrompt[]>([]);

  /**
   * After amounts change in a counted month, the count stays (it's what was in the accounts) and the
   * untraced correction should change instead. Only real amount changes count: edits to untraced
   * itself (the monthly-count flow, manual corrections) never trigger a prompt.
   */
  private checkCountedMonths(before: YearData | null, months: number[]) {
    const after = this.data();
    const totals = this.totals();
    if (!before || !after || !totals || before.year.year !== after.year.year) return;
    const untracedId = after.year.categories.find((c) => c.role === 'untraced')?.id;
    const fingerprint = (list: Entry[] = []) =>
      list.filter((e) => e.categoryId !== untracedId).map((e) => [e.id, e.categoryId, e.amount].join(':')).sort().join('|');

    const found: UntracedPrompt[] = [];
    for (const m of months) {
      if (countTotal(after.year.counts[m]) === undefined) continue; // not counted
      if (fingerprint(before.months[m]) === fingerprint(after.months[m])) continue; // only untraced changed
      const s = untracedSuggestion(after, totals, m);
      if (s && Math.abs(s.suggestion - s.current) >= 0.01) found.push({ year: after.year.year, month: m, from: s.current, to: s.suggestion });
    }
    if (found.length)
      this.untracedPrompts.update((list) => [...list.filter((p) => !found.some((f) => f.year === p.year && f.month === p.month)), ...found]);
  }
}

export function errorMessage(e: unknown): string {
  const err = e as { error?: { error?: string }; message?: string };
  return err?.error?.error ?? err?.message ?? 'Something went wrong';
}
