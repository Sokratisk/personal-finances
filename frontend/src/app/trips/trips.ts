import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronRight, lucidePlane, lucidePlus } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { MONTH_NAMES, MONTH_SHORT } from '../core/format';
import { round2 } from '../core/ledger';
import { type ItemSummary, MONTHS } from '../core/models';
import { EntryEditor } from '../year/entry-editor';

interface Trip extends ItemSummary {
  total: number;
  editable: boolean; // in the year that's currently open
}

/**
 * History of items across all years — trips by default, or any other category with items
 * (e.g. purchases). The open year's items are live from the store; other years come from the API.
 */
@Component({
  selector: 'app-trips',
  imports: [
    DecimalPipe, FormsModule, NgIcon, HlmButtonImports, HlmCardImports, HlmDialogImports, HlmInputImports,
    HlmNativeSelectImports, HlmSkeletonImports, EntryEditor,
  ],
  providers: [provideIcons({ lucideChevronDown, lucideChevronRight, lucidePlane, lucidePlus })],
  template: `
    <div class="grid gap-6">
      <div class="flex flex-wrap items-end gap-3">
        <div class="mr-auto">
          <h1 class="text-xl font-semibold">{{ activeLabel() || 'Trips' }}</h1>
          <p class="text-sm text-muted-foreground">All years. Tap one to see its expenses.</p>
        </div>
        @if (tabs().length > 1) {
          <div class="flex gap-1 rounded-lg bg-muted p-1">
            @for (t of tabs(); track t.id) {
              <button type="button" class="rounded-md px-3 py-1 text-sm font-medium"
                      [class]="t.id === activeTab() ? 'bg-background shadow-sm' : 'text-muted-foreground'"
                      (click)="activeTab.set(t.id)">{{ t.name }}</button>
            }
          </div>
        }
        @if (activeCategoryInOpenYear()) {
          <button hlmBtn size="sm" (click)="newOpen.set(true)"><ng-icon name="lucidePlus" /> New</button>
        }
      </div>

      @if (loading()) {
        <hlm-skeleton class="h-24 w-full" />
        <hlm-skeleton class="h-64 w-full" />
      } @else if (!shown().length) {
        <section hlmCard class="items-center py-10 text-center">
          <ng-icon name="lucidePlane" class="text-3xl text-muted-foreground" />
          <p class="text-muted-foreground">No trips yet. Create one with <strong>New</strong>, then add its expenses.</p>
        </section>
      } @else {
        <div class="grid grid-cols-3 gap-3">
          <div hlmCard size="sm" class="gap-0 px-4"><span class="text-xs text-muted-foreground">Total spent</span><span class="text-xl font-semibold tabular-nums">€{{ stats().total | number: '1.0-0' }}</span></div>
          <div hlmCard size="sm" class="gap-0 px-4"><span class="text-xs text-muted-foreground">Count</span><span class="text-xl font-semibold tabular-nums">{{ stats().count }}</span></div>
          <div hlmCard size="sm" class="gap-0 px-4"><span class="text-xs text-muted-foreground">Average</span><span class="text-xl font-semibold tabular-nums">€{{ stats().avg | number: '1.0-0' }}</span></div>
        </div>

        @for (y of byYear(); track y.year) {
          <section hlmCard class="gap-0 py-0">
            <div class="flex items-baseline justify-between px-4 pt-4 pb-2">
              <h2 class="font-semibold">{{ y.year }}</h2>
              <span class="text-sm text-muted-foreground tabular-nums">{{ y.trips.length }} · €{{ y.total | number: '1.2-2' }}</span>
            </div>
            @for (t of y.trips; track t.id) {
              <div class="border-t">
                <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left" (click)="toggle(t.id)">
                  <ng-icon [name]="open() === t.id ? 'lucideChevronDown' : 'lucideChevronRight'" class="shrink-0 text-muted-foreground" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium">{{ t.name }}</p>
                    <div class="mt-1 h-1.5 rounded-full bg-muted">
                      <div class="h-1.5 rounded-full bg-primary" [style.width.%]="(t.total / maxTotal()) * 100"></div>
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="font-semibold tabular-nums">€{{ t.total | number: '1.2-2' }}</p>
                    <p class="text-xs text-muted-foreground">{{ monthLabel(t) }} · {{ t.entries.length }} {{ t.entries.length === 1 ? 'expense' : 'expenses' }}</p>
                  </div>
                </button>
                @if (open() === t.id) {
                  <div class="grid gap-2 px-4 pb-4 pl-11">
                    <div class="rounded-md border text-sm">
                      @for (e of t.entries; track e.id) {
                        <div class="flex gap-2 border-b px-3 py-1.5 last:border-0">
                          <span class="w-10 shrink-0 text-xs text-muted-foreground">{{ monthShort[e.month - 1] }}</span>
                          <span class="min-w-0 flex-1 truncate">{{ e.note || '—' }}</span>
                          <span class="tabular-nums" [class.text-green-500]="e.amount < 0">{{ e.amount | number: '1.2-2' }}</span>
                        </div>
                      } @empty {
                        <p class="p-3 text-center text-muted-foreground">No expenses yet.</p>
                      }
                    </div>
                    @if (t.editable) {
                      <button hlmBtn size="sm" class="justify-self-start" (click)="addTo.set(t)"><ng-icon name="lucidePlus" /> Add expense</button>
                    }
                  </div>
                }
              </div>
            }
          </section>
        }
      }
    </div>

    <!-- Add expense to a trip -->
    <hlm-dialog [state]="addTo() ? 'open' : 'closed'" (closed)="addTo.set(null)">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-md">
        @if (addTo(); as t) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t.name }}</h2>
            <p hlmDialogDescription>Add an expense to this {{ (activeLabel() || 'trip').toLowerCase() === 'trips' ? 'trip' : 'item' }}</p>
          </hlm-dialog-header>
          <app-entry-editor [categoryId]="t.categoryId" [initialItemId]="t.id" [initialMonth]="t.month ?? todayMonth" (saved)="addTo.set(null)" />
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <!-- New trip -->
    <hlm-dialog [state]="newOpen() ? 'open' : 'closed'" (closed)="newOpen.set(false)">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-sm">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>New {{ (activeLabel() || 'trip').toLowerCase() === 'trips' ? 'trip' : 'item' }}</h2>
          <p hlmDialogDescription>In {{ store.data()?.year?.year }}. Its expenses go into "{{ activeLabel() }}" in the month you choose.</p>
        </hlm-dialog-header>
        <form class="grid gap-3" (ngSubmit)="create()">
          <input hlmInput name="name" placeholder="e.g. Crete summer" [(ngModel)]="newName" required />
          <hlm-native-select name="month" [(ngModel)]="newMonth">
            @for (m of months; track m) { <option hlmNativeSelectOption [ngValue]="m">{{ monthNames[m - 1] }}</option> }
          </hlm-native-select>
          <button hlmBtn type="submit" [disabled]="!newName.trim() || saving()">Create</button>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class Trips {
  private readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);
  protected readonly months = MONTHS;
  protected readonly monthNames = MONTH_NAMES;
  protected readonly monthShort = MONTH_SHORT;
  protected readonly todayMonth = new Date().getMonth() + 1;

  protected readonly loading = signal(true);
  private readonly otherYears = signal<ItemSummary[]>([]);
  protected readonly activeTab = signal<string | null>(null);
  protected readonly open = signal<string | null>(null);
  protected readonly addTo = signal<Trip | null>(null);
  protected readonly newOpen = signal(false);
  protected readonly saving = signal(false);
  protected newName = '';
  protected newMonth = new Date().getMonth() + 1;

  /** Open year's items computed live from the store (so adding expenses updates instantly). */
  private readonly openYearItems = computed<ItemSummary[]>(() => {
    const d = this.store.data();
    if (!d) return [];
    const catName = new Map(d.year.categories.map((c) => [c.id, c.name]));
    return d.year.items.map((it) => ({
      year: d.year.year,
      id: it.id,
      name: it.name,
      categoryId: it.categoryId,
      categoryName: catName.get(it.categoryId) ?? '',
      month: it.month,
      entries: MONTHS.flatMap((m) => (d.months[m] ?? []).filter((e) => e.itemId === it.id).map((e) => ({ id: e.id, month: m, amount: e.amount, note: e.note }))),
    }));
  });

  private readonly all = computed<Trip[]>(() => {
    const openYear = this.store.data()?.year.year;
    return [...this.otherYears().filter((i) => i.year !== openYear), ...this.openYearItems()].map((i) => ({
      ...i,
      total: round2(i.entries.reduce((s, e) => s + e.amount, 0)),
      editable: i.year === openYear,
    }));
  });

  /** One tab per category that has items (by category id, labelled with its latest name). */
  protected readonly tabs = computed(() => {
    const map = new Map<string, { id: string; name: string; year: number; count: number }>();
    for (const i of this.all()) {
      const t = map.get(i.categoryId);
      if (!t) map.set(i.categoryId, { id: i.categoryId, name: i.categoryName, year: i.year, count: 1 });
      else {
        t.count++;
        if (i.year > t.year) Object.assign(t, { name: i.categoryName, year: i.year });
      }
    }
    // Trips first, then by number of items.
    const isTrips = (n: string) => /ταξ[ιί]δ|trip|travel/i.test(n);
    return [...map.values()].sort((a, b) => Number(isTrips(b.name)) - Number(isTrips(a.name)) || b.count - a.count);
  });

  protected readonly activeLabel = computed(() => this.tabs().find((t) => t.id === this.activeTab())?.name ?? '');
  protected readonly shown = computed(() => this.all().filter((i) => i.categoryId === this.activeTab()));
  protected readonly activeCategoryInOpenYear = computed(() =>
    (this.store.data()?.year.categories ?? []).some((c) => c.id === this.activeTab() && !c.archived),
  );
  protected readonly maxTotal = computed(() => Math.max(1, ...this.shown().map((t) => t.total)));
  protected readonly stats = computed(() => {
    const list = this.shown();
    const total = round2(list.reduce((s, t) => s + t.total, 0));
    return { total, count: list.length, avg: list.length ? total / list.length : 0 };
  });
  protected readonly byYear = computed(() => {
    const years = [...new Set(this.shown().map((t) => t.year))].sort((a, b) => b - a);
    return years.map((year) => {
      const trips = this.shown()
        .filter((t) => t.year === year)
        .sort((a, b) => (b.month ?? 0) - (a.month ?? 0));
      return { year, trips, total: round2(trips.reduce((s, t) => s + t.total, 0)) };
    });
  });

  constructor() {
    void this.load();
    effect(() => {
      const first = this.tabs()[0]?.id ?? null;
      if (!this.activeTab() || !this.tabs().some((t) => t.id === this.activeTab())) this.activeTab.set(first);
    });
  }

  private async load() {
    try {
      this.otherYears.set((await this.api.allItems()).items);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(id: string) {
    this.open.set(this.open() === id ? null : id);
  }

  protected monthLabel(t: Trip) {
    const ms = [...new Set(t.entries.map((e) => e.month))].sort((a, b) => a - b);
    if (!ms.length) return t.month ? MONTH_SHORT[t.month - 1] : '—';
    return ms.length === 1 ? MONTH_SHORT[ms[0]! - 1] : `${MONTH_SHORT[ms[0]! - 1]}–${MONTH_SHORT[ms.at(-1)! - 1]}`;
  }

  protected async create() {
    const categoryId = this.activeTab();
    if (!categoryId) return;
    this.saving.set(true);
    try {
      this.store.applyYear(await this.api.addItem(this.store.y, { categoryId, name: this.newName.trim(), month: Number(this.newMonth) }));
      toast.success(`"${this.newName.trim()}" created — add its expenses`);
      this.newName = '';
      this.newOpen.set(false);
      // Open the new trip so "Add expense" is right there.
      const created = this.store.items().at(-1);
      if (created) this.open.set(created.id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
