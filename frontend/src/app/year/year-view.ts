import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, Injector, computed, effect, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronLeft, lucideChevronRight, lucideChevronsDownUp, lucideChevronsUpDown, lucidePlus, lucideScale } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { FinanceStore } from '../core/finance.store';
import { MONTH_SHORT, monthName } from '../core/format';
import { countTotal, rowTotal } from '../core/ledger';
import { type Category, type Kind, MONTHS } from '../core/models';
import { topOnPhone } from '../shared/dialog-position';
import { SummaryCards } from '../shared/summary-cards';
import { CellPanel } from './cell-panel';
import { CountPanel } from './count-panel';
import { EntryEditor } from './entry-editor';
import { NewYearPanel } from './new-year-panel';

interface Section {
  key: string;
  label: string;
  kind: Kind;
  categories: Category[];
  /** Per-month totals, index 1..12. */
  totals: number[];
  total: number;
}

const COLLAPSED_KEY = 'pf-collapsed-groups';
function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable */
  }
}

/** Whether the phone auto-open of the Add dialog already happened in this app session. */
let autoAddShown = false;

/** The main screen: the year laid out like the budget sheet (desktop) or month by month (phone). */
@Component({
  selector: 'app-year-view',
  imports: [
    DecimalPipe, NgTemplateOutlet, NgIcon, HlmButtonImports, HlmCardImports, HlmDialogImports, HlmSkeletonImports,
    SummaryCards, CellPanel, CountPanel, EntryEditor, NewYearPanel,
  ],
  providers: [provideIcons({ lucideChevronDown, lucideChevronLeft, lucideChevronRight, lucideChevronsDownUp, lucideChevronsUpDown, lucidePlus, lucideScale })],
  styles: `
    .grid-table td, .grid-table th { padding: 0.4rem 0.6rem; white-space: nowrap; }
    .grid-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .grid-table td:first-child, .grid-table th:first-child { position: sticky; left: 0; z-index: 1; background: var(--card); }
    .grid-table tbody tr { border-bottom: 1px solid color-mix(in oklch, var(--border) 70%, transparent); }

    /* Outer level: group rows (Bills, Home & food…) — tinted, bold, click to collapse */
    .grid-table tr.group td { background: color-mix(in oklch, var(--muted) 75%, var(--card)); font-weight: 600; padding-top: 0.55rem; padding-bottom: 0.55rem; cursor: pointer; }
    .grid-table tr.group:hover td { background: var(--muted); }
    .grid-table tr.group td:first-child { box-shadow: inset 3px 0 0 var(--primary); }

    /* Inner level: categories — indented, lighter */
    .grid-table tr.cat td:first-child { padding-left: 2.25rem; color: color-mix(in oklch, var(--foreground) 78%, transparent); }
    .grid-table tr.cat td.num { color: color-mix(in oklch, var(--foreground) 85%, transparent); }
    .grid-table tr.cat:hover td { background: color-mix(in oklch, var(--muted) 35%, var(--card)); }

    /* Summary rows */
    .grid-table tr.summary td { font-weight: 600; border-top: 2px solid var(--border); }
    .grid-table tr.result td { font-weight: 700; background: color-mix(in oklch, var(--primary) 14%, var(--card)); }
    .grid-table tr.spacer { border-bottom: none; }
    .grid-table tr.spacer td { height: 0.6rem; padding: 0; }

    .cell { cursor: pointer; }
    .cell:hover { outline: 1px solid var(--ring); outline-offset: -1px; border-radius: 0.25rem; }
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
        <section hlmCard class="hidden gap-0 overflow-hidden py-0 lg:flex">
          <div class="flex items-center justify-end gap-1 border-b px-3 py-1.5">
            <button hlmBtn variant="ghost" size="xs" (click)="expandAll()"><ng-icon name="lucideChevronsUpDown" /> Expand all</button>
            <button hlmBtn variant="ghost" size="xs" (click)="collapseAll()"><ng-icon name="lucideChevronsDownUp" /> Collapse all</button>
          </div>
          <div class="overflow-x-auto">
            <table class="grid-table w-full text-sm">
              <thead class="sticky top-0 bg-card">
                <tr class="border-b-2">
                  <th class="min-w-52 text-left">Category</th>
                  <th class="num">Total</th>
                  @for (m of months; track m) {
                    <th class="num font-medium" [class.text-primary]="m === currentMonth()">{{ monthShort[m - 1] }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (sec of incomeSections(); track sec.key) {
                  <ng-container *ngTemplateOutlet="groupRows; context: { $implicit: sec }" />
                }
                <tr class="text-muted-foreground">
                  <td>From {{ d.year.year - 1 }}</td>
                  <td class="num">{{ d.year.opening | number: '1.2-2' }}</td>
                  <td colspan="12"></td>
                </tr>
                <tr class="spacer"><td colspan="14"></td></tr>

                @for (sec of expenseSections(); track sec.key) {
                  <ng-container *ngTemplateOutlet="groupRows; context: { $implicit: sec }" />
                }
                <tr class="summary">
                  <td>Expenses</td>
                  <td class="num text-red-400">{{ t().year.expenses | number: '1.2-2' }}</td>
                  @for (m of months; track m) { <td class="num">{{ show(t().expenses[m]) }}</td> }
                </tr>
                <tr>
                  <td>Before stocks</td>
                  <td class="num">{{ t().year.income - t().year.expenses | number: '1.2-2' }}</td>
                  @for (m of months; track m) { <td class="num" [class.text-red-400]="t().beforeStocks[m]! < 0">{{ show(t().beforeStocks[m]) }}</td> }
                </tr>
                <tr class="spacer"><td colspan="14"></td></tr>

                @for (sec of stockSections(); track sec.key) {
                  <ng-container *ngTemplateOutlet="groupRows; context: { $implicit: sec }" />
                }
                <tr class="summary result">
                  <td>Result</td>
                  <td class="num">{{ t().year.final | number: '1.2-2' }}</td>
                  @for (m of months; track m) { <td class="num" [class.text-red-400]="t().result[m]! < 0" [class.text-green-500]="t().result[m]! > 0">{{ show(t().result[m]) }}</td> }
                </tr>
                <tr class="spacer"><td colspan="14"></td></tr>

                <tr class="group" (click)="toggle('count')" [attr.aria-expanded]="isOpen('count')">
                  <td><ng-icon [name]="isOpen('count') ? 'lucideChevronDown' : 'lucideChevronRight'" class="mr-1 align-[-2px]" />Monthly count</td>
                  <td></td>
                  @for (m of months; track m) {
                    <td class="num cell" title="Monthly count" (click)="$event.stopPropagation(); countMonth.set(m)">{{ countOf(m) === undefined ? '＋' : (countOf(m) | number: '1.2-2') }}</td>
                  }
                </tr>
                @if (isOpen('count')) {
                  <tr class="cat">
                    <td>Stocks value</td>
                    <td></td>
                    @for (m of months; track m) { <td class="num">{{ show(d.year.counts[m]?.stocksValue) }}</td> }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- One group: tinted header row with the group's totals (click to collapse), then its categories -->
        <ng-template #groupRows let-sec>
          <tr class="group" (click)="toggle(sec.key)" [attr.aria-expanded]="isOpen(sec.key)">
            <td>
              <ng-icon [name]="isOpen(sec.key) ? 'lucideChevronDown' : 'lucideChevronRight'" class="mr-1 align-[-2px]" />{{ sec.label }}
              @if (!isOpen(sec.key)) { <span class="ml-1 text-xs font-normal text-muted-foreground">({{ sec.categories.length }})</span> }
            </td>
            <td class="num"><span [class.text-green-500]="sec.kind === 'income'">{{ show(sec.total) }}</span></td>
            @for (m of months; track m) { <td class="num">{{ show(sec.totals[m]) }}</td> }
          </tr>
          @if (isOpen(sec.key)) {
            @for (c of sec.categories; track c.id) {
              <tr class="cat" [class.opacity-60]="c.archived">
                <td>{{ c.name }}</td>
                <td class="num font-medium">{{ show(rowTotal(t().byCategory.get(c.id))) }}</td>
                @for (m of months; track m) {
                  <td class="num cell" (click)="openCell(c, m)">{{ show(t().byCategory.get(c.id)?.[m]) }}</td>
                }
              </tr>
            }
          }
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
          <div class="flex justify-end gap-1">
            <button hlmBtn variant="ghost" size="xs" (click)="expandAll()"><ng-icon name="lucideChevronsUpDown" /> Expand all</button>
            <button hlmBtn variant="ghost" size="xs" (click)="collapseAll()"><ng-icon name="lucideChevronsDownUp" /> Collapse all</button>
          </div>
          @for (sec of allSections(); track sec.key) {
            <div hlmCard size="sm" class="gap-0 overflow-hidden py-0">
              <button type="button" class="flex w-full items-center gap-2 border-l-[3px] border-primary bg-muted/60 px-4 py-3 text-left text-sm font-semibold"
                      (click)="toggle(sec.key)" [attr.aria-expanded]="isOpen(sec.key)">
                <ng-icon [name]="isOpen(sec.key) ? 'lucideChevronDown' : 'lucideChevronRight'" class="text-muted-foreground" />
                <span class="flex-1">{{ sec.label }}</span>
                <span class="tabular-nums" [class.text-green-500]="sec.kind === 'income'">{{ show(sec.totals[phoneMonth()]) || '—' }}</span>
              </button>
              @if (isOpen(sec.key)) {
                @for (c of sec.categories; track c.id) {
                  <button type="button" class="flex w-full items-center justify-between border-t py-2.5 pr-4 pl-10 text-left text-sm" (click)="openCell(c, phoneMonth())">
                    <span class="text-foreground/80" [class.opacity-60]="c.archived">{{ c.name }}</span>
                    <span class="tabular-nums text-foreground/85">{{ show(t().byCategory.get(c.id)?.[phoneMonth()]) || '—' }}</span>
                  </button>
                }
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
    <hlm-dialog [state]="cell() ? 'open' : 'closed'" (closed)="cell.set(null)" [positionStrategy]="cellPos()">
      <hlm-dialog-content *hlmDialogPortal class="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-w-md">
        @if (cell(); as c) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ c.category.name }}</h2>
            <p hlmDialogDescription>{{ monthName(c.month) }} {{ store.data()?.year?.year }}</p>
          </hlm-dialog-header>
          <app-cell-panel [categoryId]="c.category.id" [month]="c.month" />
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-dialog [state]="addOpen() ? 'open' : 'closed'" (closed)="addOpen.set(false)" [positionStrategy]="addPos()">
      <hlm-dialog-content *hlmDialogPortal class="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-w-md">
        <hlm-dialog-header><h2 hlmDialogTitle>Add amount</h2></hlm-dialog-header>
        <app-entry-editor [initialMonth]="todayMonth" (saved)="addOpen.set(false)" />
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-dialog [state]="countMonth() ? 'open' : 'closed'" (closed)="countMonth.set(null)" [positionStrategy]="countPos()">
      <hlm-dialog-content *hlmDialogPortal class="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-w-md">
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
  // Forms with inputs sit near the top on phones so the keyboard doesn't cover them.
  private readonly injector = inject(Injector);
  protected readonly addPos = topOnPhone(this.injector, this.addOpen);
  protected readonly cellPos = topOnPhone(this.injector, this.cell);
  protected readonly countPos = topOnPhone(this.injector, this.countMonth);

  /** The Add dialog always starts on the current calendar month. */
  protected readonly todayMonth = new Date().getMonth() + 1;

  constructor() {
    effect(() => saveCollapsed(this.collapsed()));

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

  /** Groups shown in the table: each with its categories and per-month totals (index 1..12). */
  private readonly sections = computed<Section[]>(() => {
    const t = this.store.totals();
    const make = (key: string, label: string, kind: Kind, categories: Category[]): Section => {
      const totals = Array<number>(13).fill(0);
      for (const c of categories) {
        const row = t?.byCategory.get(c.id);
        if (row) for (const m of MONTHS) totals[m] = totals[m]! + row[m]!;
      }
      return { key, label, kind, categories, totals, total: rowTotal(totals) };
    };
    const cats = this.store.categories();
    return [
      make('income', 'Income', 'income', cats.filter((c) => c.kind === 'income')),
      ...this.store.expenseGroups().map((g) => make(`g:${g.group}`, g.group, 'expense', g.categories)),
      make('stocks', 'Stocks', 'stocks', cats.filter((c) => c.kind === 'stocks')),
    ].filter((sec) => sec.categories.length);
  });
  protected readonly allSections = this.sections;
  protected readonly incomeSections = computed(() => this.sections().filter((x) => x.kind === 'income'));
  protected readonly expenseSections = computed(() => this.sections().filter((x) => x.kind === 'expense'));
  protected readonly stockSections = computed(() => this.sections().filter((x) => x.kind === 'stocks'));

  /** Collapsed groups (remembered on this device). */
  protected readonly collapsed = signal<Set<string>>(loadCollapsed());
  protected isOpen(key: string) {
    return !this.collapsed().has(key);
  }
  protected toggle(key: string) {
    this.collapsed.update((set) => {
      const n = new Set(set);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }
  protected collapseAll() {
    this.collapsed.set(new Set([...this.sections().map((x) => x.key), 'count']));
  }
  protected expandAll() {
    this.collapsed.set(new Set());
  }

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
