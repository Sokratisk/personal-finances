import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideArrowUpDown, lucideSearch, lucideTrash2 } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmTableImports } from '@spartan-ng/helm/table';
import {
  type SortingState,
  createColumnHelper,
  createSortedRowModel,
  injectTable,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
} from '@tanstack/angular-table';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { MONTH_SHORT } from '../core/format';
import { MONTHS } from '../core/models';

interface Row {
  /** When it was added (ISO). Undefined for amounts imported from the spreadsheet. */
  added?: string;
  id: string;
  month: number;
  category: string;
  kind: string;
  /** Item and note aren't shown as columns but are still searchable. */
  item: string;
  note: string;
  amount: number;
}

// TanStack Table v9: only sorting is needed; search and the month filter narrow the rows before the table.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
const col = createColumnHelper<typeof features, Row>();
const columns = col.columns([
  col.accessor('added', { header: 'Added', sortFn: 'basic', sortUndefined: 'last' }),
  col.accessor('category', { header: 'Category', sortFn: 'alphanumeric' }),
  col.accessor('amount', { header: 'Amount', sortFn: 'basic' }),
]);

/** Every amount of the year in one searchable, sortable list. */
@Component({
  selector: 'app-entries',
  imports: [DatePipe, DecimalPipe, NgIcon, HlmButtonImports, HlmCardImports, HlmInputImports, HlmNativeSelectImports, HlmTableImports],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideArrowUpDown, lucideSearch, lucideTrash2 })],
  template: `
    <div class="grid gap-4">
      <h1 class="text-xl font-semibold">Entries · {{ store.data()?.year?.year }}</h1>

      <div class="flex flex-wrap items-center gap-2">
        <div class="relative min-w-48 flex-1">
          <ng-icon name="lucideSearch" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <input hlmInput type="search" class="w-full pl-8" placeholder="Search category, trip or note…"
                 [value]="search()" (input)="search.set($any($event.target).value)" />
        </div>
        <hlm-native-select class="w-36" [value]="monthFilter()" (change)="monthFilter.set($any($event.target).value)">
          <option hlmNativeSelectOption value="">All months</option>
          @for (m of months; track m) { <option hlmNativeSelectOption [value]="'' + m">{{ monthShort[m - 1] }}</option> }
        </hlm-native-select>
        <span class="text-sm text-muted-foreground">{{ filtered().length }} entries · <span class="sensitive">{{ shownTotal() | number: '1.2-2' }}</span></span>
      </div>

      <section hlmCard class="py-0">
        <div hlmTableContainer class="max-h-[70vh]">
          <table hlmTable>
            <thead hlmTHead class="sticky top-0 bg-card">
              @for (group of table.getHeaderGroups(); track group.id) {
                <tr hlmTr>
                  @for (header of group.headers; track header.id) {
                    <th hlmTh [class.text-right]="header.column.id === 'amount'">
                      <button hlmBtn variant="ghost" size="sm" class="-mx-2.5" (click)="header.column.toggleSorting()">
                        {{ header.column.columnDef.header }}
                        <ng-icon [name]="sortIcon(header.column.getIsSorted())" class="text-muted-foreground" />
                      </button>
                    </th>
                  }
                  <th hlmTh class="w-10"><span class="sr-only">Actions</span></th>
                </tr>
              }
            </thead>
            <tbody hlmTBody>
              @for (row of table.getRowModel().rows; track row.id) {
                <tr hlmTr>
                  <td hlmTd class="whitespace-nowrap text-muted-foreground" [title]="row.original.added ? (row.original.added | date: 'd MMM y, HH:mm') : 'Imported (no time recorded)'">
                    {{ row.original.added ? (row.original.added | date: 'dd/MM HH:mm') : '—' }}
                  </td>
                  <td hlmTd>{{ row.original.category }}</td>
                  <td hlmTd class="text-right tabular-nums">
                    <span [class]="row.original.kind === 'income' ? 'text-green-500' : ''">{{ row.original.amount | number: '1.2-2' }}</span>
                  </td>
                  <td hlmTd class="w-10">
                    <button hlmBtn variant="ghost" size="icon-sm" aria-label="Delete" (click)="remove(row.original)"><ng-icon name="lucideTrash2" /></button>
                  </td>
                </tr>
              } @empty {
                <tr hlmTr><td hlmTd colspan="4" class="h-24 text-center text-muted-foreground">No entries.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class Entries {
  private readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);
  protected readonly months = MONTHS;
  protected readonly monthShort = MONTH_SHORT;

  protected readonly search = signal('');
  protected readonly monthFilter = signal('');
  private readonly sorting = signal<SortingState>([{ id: 'added', desc: true }]); // most recent first

  private readonly rows = computed<Row[]>(() => {
    const d = this.store.data();
    if (!d) return [];
    const cats = new Map(d.year.categories.map((c) => [c.id, c]));
    const items = new Map(d.year.items.map((i) => [i.id, i.name]));
    // Newest month and newest entry first, so amounts without a timestamp (imported) still read newest → oldest.
    return [...MONTHS].reverse().flatMap((m) =>
      [...(d.months[m] ?? [])].reverse().map((e) => ({
        id: e.id,
        month: m,
        category: cats.get(e.categoryId)?.name ?? '?',
        kind: cats.get(e.categoryId)?.kind ?? 'expense',
        item: e.itemId ? (items.get(e.itemId) ?? '') : '',
        note: e.note ?? '',
        added: e.createdAt,
        amount: e.amount,
      })),
    );
  });

  /** Month filter + search (category, trip/item name or note). */
  protected readonly filtered = computed(() => {
    const month = Number(this.monthFilter()) || 0;
    const q = this.search().trim().toLowerCase();
    return this.rows().filter(
      (r) => (!month || r.month === month) && (!q || `${r.category} ${r.item} ${r.note}`.toLowerCase().includes(q)),
    );
  });

  protected readonly table = injectTable(() => ({
    features,
    columns,
    data: this.filtered(),
    getRowId: (r: Row) => r.id,
    state: { sorting: this.sorting() },
    onSortingChange: (u) => (typeof u === 'function' ? this.sorting.update(u) : this.sorting.set(u)),
  }));

  /** Sum of the listed expenses (income excluded). */
  protected readonly shownTotal = computed(() =>
    this.filtered().reduce((s, r) => s + (r.kind === 'income' ? 0 : r.amount), 0),
  );

  protected sortIcon(dir: false | 'asc' | 'desc') {
    return dir === 'asc' ? 'lucideArrowUp' : dir === 'desc' ? 'lucideArrowDown' : 'lucideArrowUpDown';
  }

  protected async remove(r: Row) {
    if (!confirm(`Delete ${r.amount.toFixed(2)} from ${r.category}?`)) return;
    try {
      this.store.applyMonths(await this.api.deleteEntry(this.store.y, r.month, r.id));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
}
