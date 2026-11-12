import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService, type MonthsResponse, type ProfileResponse, type YearResponse } from './api.service';
import { computeTotals, groupExpenses, visibleCategories } from './ledger';
import type { Profile, YearData } from './models';

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

  // ----- apply API responses -----
  applyProfile(r: ProfileResponse) {
    this.profile.set(r.profile);
    this.serviceAccountEmail.set(r.serviceAccountEmail);
  }
  applyYear(r: YearResponse) {
    this.data.update((d) => (d && d.year.year === r.year.year ? { ...d, year: r.year } : d));
  }
  applyMonths(r: MonthsResponse) {
    this.data.update((d) => (d ? { ...d, year: r.year ?? d.year, months: { ...d.months, ...r.months } } : d));
  }
}

export function errorMessage(e: unknown): string {
  const err = e as { error?: { error?: string }; message?: string };
  return err?.error?.error ?? err?.message ?? 'Something went wrong';
}
