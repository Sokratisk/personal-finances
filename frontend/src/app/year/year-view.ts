import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucidePlus, lucideScale } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { FinanceStore } from '../core/finance.store';
import { MONTH_SHORT, monthName } from '../core/format';
import { countTotal, rowTotal } from '../core/ledger';
import { type Category, MONTHS } from '../core/models';
import { SummaryCards } from '../shared/summary-cards';
import { CellPanel } from './cell-panel';
import { CountPanel } from './count-panel';
import { EntryEditor } from './entry-editor';
import { NewYearPanel } from './new-year-panel';

/** Whether the phone auto-open of the Add dialog already happened in this app session. */
let autoAddShown = false;

/** The main screen: the year laid out like the budget sheet (desktop) or month by month (phone). */
@Component({
  selector: 'app-year-view',
  imports: [
    DecimalPipe, NgTemplateOutlet, NgIcon, HlmButtonImports, HlmCardImports, HlmDialogImports, HlmSkeletonImports,
    SummaryCards, CellPanel, CountPanel, EntryEditor, NewYearPanel,
  ],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucidePlus, lucideScale })],
  styles: `
    .grid-table td, .grid-table th { padding: 0.3rem 0.5rem; white-space: nowrap; }
    .grid-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .cell { cursor: pointer; border-radius: 0.25rem; }
    .cell:hover { background: var(--muted); }
  `,
  template: `
    @if (!store.years().length && !store.loading()) {
      <section hlmCard class="mx-auto max-w-md items-center py-10 text-center">
        <h2 class="text-lg font-semibold">Start your first year</h2>
        <p class="text-sm text-muted-foreground">Create a year to begin tracking.</p>
        <button hlmBtn (click)="newYearOpen.set(true)"><ng-icon name="lucidePlus" /> New year</button>
      </section>
    } @else if (store.data(); as d) {
      <div class="grid gap-6">
        <app-summary-cards />

        <div class="flex flex-wrap items-center gap-2">
          <h1 class="mr-auto text-xl font-semibold">{{ d.year.year }}</h1>
          <button hlmBtn variant="outline" size="sm" (click)="countMonth.set(phoneMonth())">
            <ng-icon name="lucideScale" /> Monthly count
          </button>
          <button hlmBtn variant="outline" size="sm" (click)="newYearOpen.set(true)">New year</button>
          <button hlmBtn size="sm" (click)="addOpen.set(true)"><ng-icon name="lucidePlus" /> Add</button>
        </div>

        <!-- Desktop: sheet layout -->
        <section hlmCard class="hidden overflow-hidden py-0 lg:flex">
          <div class="overflow-x-auto">
            <table class="grid-table w-full text-sm">
              <thead class="sticky top-0 bg-card">
                <tr class="border-b">
                  <th class="sticky left-0 z-10 min-w-44 bg-card text-left">Category</th>
                  <th class="text-right">Total</th>
                  @for (m of months; track m) {
                    <th class="text-right font-medium" [class.text-primary]="m === currentMonth()">{{ monthShort[m - 1] }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                <tr><td colspan="14" class="pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Income</td></tr>
                @for (c of incomeCats(); track c.id) {
                  <ng-container *ngTemplateOutlet="catRow; context: { $implicit: c }" />
                }
                <tr class="border-t font-semibold">
                  <td class="sticky left-0 bg-card">Income</td>
                  <td class="num text-green-500">{{ t().year.income | number: '1.2-2' }}</td>
                  @for (m of months; track m) { <td class="num">{{ show(t().income[m]) }}</td> }
                </tr>
                <tr class="text-muted-foreground">
                  <td class="sticky left-0 bg-card">From {{ d.year.year - 1 }}</td>
                  <td class="num">{{ d.year.opening | number: '1.2-2' }}</td>
                  <td colspan="12"></td>
                </tr>

                @for (g of store.expenseGroups(); track g.group) {
                  <tr><td colspan="14" class="pt-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ g.group }}</td></tr>
                  @for (c of g.categories; track c.id) {
                    <ng-container *ngTemplateOutlet="catRow; context: { $implicit: c }" />
                  }
                }
                <tr class="border-t font-semibold">
                  <td class="sticky left-0 bg-card">Expenses</td>
                  <td class="num text-red-400">{{ t().year.expenses | number: '1.2-2' }}</td>
                  @for (m of months; track m) { <td class="num">{{ show(t().expenses[m]) }}</td> }
                </tr>
                <tr>
                  <td class="sticky left-0 bg-card">Before stocks</td>
                  <td class="num">{{ t().year.income - t().year.expenses | number: '1.2-2' }}</td>
                  @for (m of months; track m) { <td class="num" [class.text-red-400]="t().beforeStocks[m]! < 0">{{ show(t().beforeStocks[m]) }}</td> }
                </tr>
                @for (c of stockCats(); track c.id) {
                  <ng-container *ngTemplateOutlet="catRow; context: { $implicit: c }" />
                }
                <tr class="border-t border-b-2 font-semibold">
                  <td class="sticky left-0 bg-card">Result</td>
                  <td class="num">{{ t().year.final | number: '1.2-2' }}</td>
                  @for (m of months; track m) { <td class="num" [class.text-red-400]="t().result[m]! < 0" [class.text-green-500]="t().result[m]! > 0">{{ show(t().result[m]) }}</td> }
                </tr>

                <tr><td colspan="14" class="pt-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Monthly count</td></tr>
                <tr>
                  <td class="sticky left-0 bg-card">Counted total</td>
                  <td></td>
                  @for (m of months; track m) {
                    <td class="num cell" title="Monthly count" (click)="countMonth.set(m)">{{ countOf(m) === undefined ? '＋' : (countOf(m) | number: '1.2-2') }}</td>
                  }
                </tr>
                <tr class="text-muted-foreground">
                  <td class="sticky left-0 bg-card">Stocks value</td>
                  <td></td>
                  @for (m of months; track m) { <td class="num">{{ show(d.year.counts[m]?.stocksValue) }}</td> }
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <ng-template #catRow let-c>
          <tr [class.text-muted-foreground]="c.archived">
            <td class="sticky left-0 bg-card">{{ c.name }}</td>
            <td class="num font-medium">{{ show(rowTotal(t().byCategory.get(c.id))) }}</td>
            @for (m of months; track m) {
              <td class="num cell" (click)="openCell(c, m)">{{ show(t().byCategory.get(c.id)?.[m]) }}</td>
            }
          </tr>
        </ng-template>

        <!-- Phone: one month at a time -->
        <section class="grid gap-3 lg:hidden">
          <div class="flex items-center justify-between">
            <button hlmBtn variant="ghost" size="icon" aria-label="Previous month" [disabled]="phoneMonth() === 1" (click)="phoneMonth.set(phoneMonth() - 1)">
              <ng-icon name="lucideChevronLeft" />
            </button>
            <p class="font-semibold">{{ monthName(phoneMonth()) }} {{ d.year.year }}</p>
            <button hlmBtn variant="ghost" size="icon" aria-label="Next month" [disabled]="phoneMonth() === 12" (click)="phoneMonth.set(phoneMonth() + 1)">
              <ng-icon name="lucideChevronRight" />
            </button>
          </div>
          <div class="grid grid-cols-3 gap-2 text-center text-sm">
            <div hlmCard size="sm" class="gap-0 py-2"><span class="text-muted-foreground">Income</span><span class="sensitive font-semibold text-green-500">{{ t().income[phoneMonth()] | number: '1.0-0' }}</span></div>
            <div hlmCard size="sm" class="gap-0 py-2"><span class="text-muted-foreground">Expenses</span><span class="sensitive font-semibold text-red-400">{{ t().expenses[phoneMonth()] | number: '1.0-0' }}</span></div>
            <div hlmCard size="sm" class="gap-0 py-2"><span class="text-muted-foreground">Result</span><span class="sensitive font-semibold">{{ t().result[phoneMonth()] | number: '1.0-0' }}</span></div>
          </div>
          @for (section of phoneSections(); track section.label) {
            <div hlmCard size="sm" class="gap-0 py-0">
              <p class="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ section.label }}</p>
              @for (c of section.categories; track c.id) {
                <button type="button" class="flex w-full items-center justify-between border-t px-4 py-2.5 text-left text-sm" (click)="openCell(c, phoneMonth())">
                  <span [class.text-muted-foreground]="c.archived">{{ c.name }}</span>
                  <span class="tabular-nums">{{ show(t().byCategory.get(c.id)?.[phoneMonth()]) || '—' }}</span>
                </button>
              }
            </div>
          }
        </section>
      </div>
    } @else {
      <div class="grid gap-3">
        <hlm-skeleton class="h-24 w-full" />
        <hlm-skeleton class="h-96 w-full" />
      </div>
    }

    <!-- Dialogs -->
    <hlm-dialog [state]="cell() ? 'open' : 'closed'" (closed)="cell.set(null)">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-md">
        @if (cell(); as c) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ c.category.name }}</h2>
            <p hlmDialogDescription>{{ monthName(c.month) }} {{ store.data()?.year?.year }}</p>
          </hlm-dialog-header>
          <app-cell-panel [categoryId]="c.category.id" [month]="c.month" />
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-dialog [state]="addOpen() ? 'open' : 'closed'" (closed)="addOpen.set(false)">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-md">
        <hlm-dialog-header><h2 hlmDialogTitle>Add amount</h2></hlm-dialog-header>
        <app-entry-editor [initialMonth]="todayMonth" (saved)="addOpen.set(false)" />
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-dialog [state]="countMonth() ? 'open' : 'closed'" (closed)="countMonth.set(null)">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-md">
        @if (countMonth(); as m) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>Monthly count</h2>
            <div class="flex items-center gap-1">
              <button hlmBtn variant="ghost" size="icon-xs" aria-label="Previous month" [disabled]="m === 1" (click)="countMonth.set(m - 1)"><ng-icon name="lucideChevronLeft" /></button>
              <p hlmDialogDescription>{{ monthName(m) }} {{ store.data()?.year?.year }}</p>
              <button hlmBtn variant="ghost" size="icon-xs" aria-label="Next month" [disabled]="m === 12" (click)="countMonth.set(m + 1)"><ng-icon name="lucideChevronRight" /></button>
            </div>
          </hlm-dialog-header>
          <app-count-panel [month]="m" (done)="countMonth.set(null)" />
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-dialog [state]="newYearOpen() ? 'open' : 'closed'" (closed)="newYearOpen.set(false)">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-lg">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>New year</h2>
          <p hlmDialogDescription>Starts clean — only the categories you pick are copied.</p>
        </hlm-dialog-header>
        <app-new-year-panel (created)="newYearOpen.set(false)" />
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class YearView {
  protected readonly store = inject(FinanceStore);
  protected readonly months = MONTHS;
  protected readonly monthShort = MONTH_SHORT;
  protected readonly monthName = monthName;
  protected readonly rowTotal = rowTotal;

  protected readonly cell = signal<{ category: Category; month: number } | null>(null);
  protected readonly addOpen = signal(false);
  protected readonly countMonth = signal<number | null>(null);
  protected readonly newYearOpen = signal(false);

  protected readonly t = computed(() => this.store.totals()!);
  protected readonly currentMonth = computed(() =>
    this.store.data()?.year.year === new Date().getFullYear() ? new Date().getMonth() + 1 : null,
  );
  protected readonly phoneMonth = signal(this.currentMonth() ?? new Date().getMonth() + 1);
  /** The Add dialog always starts on the current calendar month. */
  protected readonly todayMonth = new Date().getMonth() + 1;

  constructor() {
    // On phones, open the Add dialog once per app launch — quick entry is the main use there.
    // Only for the current year, so amounts never land in the wrong year by accident.
    effect(() => {
      const d = this.store.data();
      if (autoAddShown || !d) return;
      autoAddShown = true;
      const isPhone = window.matchMedia?.('(max-width: 1023px)').matches; // below the lg breakpoint
      if (isPhone && d.year.year === new Date().getFullYear()) this.addOpen.set(true);
    });
  }

  protected readonly incomeCats = computed(() => this.store.categories().filter((c) => c.kind === 'income'));
  protected readonly stockCats = computed(() => this.store.categories().filter((c) => c.kind === 'stocks'));
  protected readonly phoneSections = computed(() => [
    { label: 'Income', categories: this.incomeCats() },
    ...this.store.expenseGroups().map((g) => ({ label: g.group, categories: g.categories })),
    { label: 'Stocks', categories: this.stockCats() },
  ].filter((s) => s.categories.length));

  protected countOf(m: number) {
    return countTotal(this.store.data()?.year.counts[m]);
  }

  protected openCell(category: Category, month: number) {
    this.cell.set({ category, month });
  }

  /** Blank for zero/empty, otherwise 1,234.56 */
  protected show(v: number | undefined | null): string {
    if (v === undefined || v === null || Math.abs(v) < 0.005) return '';
    return v.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
