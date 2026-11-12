import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideArrowUpDown, lucideSearch, lucideTrash2 } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmTableImports } from '@spartan-ng/helm/table';
import {
  type ColumnFiltersState,
  type SortingState,
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_equals,
  filterFn_includesString,
  globalFilteringFeature,
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
  id: string;
  month: number;
  categoryId: string;
  category: string;
  kind: string;
  item: string;
  note: string;
  amount: number;
}

// TanStack Table v9: register only the features we use.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString, equals: filterFn_equals },
});
const col = createColumnHelper<typeof features, Row>();
const columns = col.columns([
  col.accessor('month', { header: 'Month', sortFn: 'basic', filterFn: 'equals', enableGlobalFilter: false }),
  col.accessor('category', { header: 'Category', sortFn: 'alphanumeric' }),
  col.accessor('item', { header: 'Item', sortFn: 'alphanumeric' }),
  col.accessor('note', { header: 'Note', sortFn: 'alphanumeric' }),
  col.accessor('amount', { header: 'Amount', sortFn: 'basic', enableGlobalFilter: false }),
]);

/** Every amount of the year in one searchable, sortable list. */
@Component({
  selector: 'app-entries',
  imports: [DecimalPipe, NgIcon, HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmInputImports, HlmNativeSelectImports, HlmTableImports],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideArrowUpDown, lucideSearch, lucideTrash2 })],
  template: `
    <div class="grid gap-4">
      <h1 class="text-xl font-semibold">Entries · {{ store.data()?.year?.year }}</h1>

      <div class="flex flex-wrap items-center gap-2">
        <div class="relative min-w-48 flex-1">
          <ng-icon name="lucideSearch" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <input hlmInput type="search" class="w-full pl-8" placeholder="Search category, item or note…"
                 [value]="search()" (input)="search.set($any($event.target).value)" />
        </div>
        <hlm-native-select class="w-36" [value]="monthFilter()" (change)="setMonth($any($event.target).value)">
          <option hlmNativeSelectOption value="">All months</option>
          @for (m of months; track m) { <option hlmNativeSelectOption [value]="m">{{ monthShort[m - 1] }}</option> }
        </hlm-native-select>
        <span class="text-sm text-muted-foreground">{{ table.getRowModel().rows.length }} entries · <span class="sensitive">{{ shownTotal() | number: '1.2-2' }}</span></span>
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
                  <td hlmTd class="text-muted-foreground">{{ monthShort[row.original.month - 1] }}</td>
                  <td hlmTd>{{ row.original.category }}</td>
                  <td hlmTd>@if (row.original.item) { <span hlmBadge variant="secondary">{{ row.original.item }}</span> }</td>
                  <td hlmTd class="max-w-64 truncate text-muted-foreground">{{ row.original.note }}</td>
                  <td hlmTd class="text-right tabular-nums">
                    <span [class]="row.original.kind === 'income' ? 'text-green-500' : ''">{{ row.original.amount | number: '1.2-2' }}</span>
                  </td>
                  <td hlmTd>
                    <button hlmBtn variant="ghost" size="icon-sm" aria-label="Delete" (click)="remove(row.original)"><ng-icon name="lucideTrash2" /></button>
                  </td>
                </tr>
              } @empty {
                <tr hlmTr><td hlmTd colspan="6" class="h-24 text-center text-muted-foreground">No entries.</td></tr>
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
  private readonly sorting = signal<SortingState>([{ id: 'month', desc: true }]);
  private readonly columnFilters = signal<ColumnFiltersState>([]);

  private readonly rows = computed<Row[]>(() => {
    const d = this.store.data();
    if (!d) return [];
    const cats = new Map(d.year.categories.map((c) => [c.id, c]));
    const items = new Map(d.year.items.map((i) => [i.id, i.name]));
    return MONTHS.flatMap((m) =>
      (d.months[m] ?? []).map((e) => ({
        id: e.id,
        month: m,
        categoryId: e.categoryId,
        category: cats.get(e.categoryId)?.name ?? '?',
        kind: cats.get(e.categoryId)?.kind ?? 'expense',
        item: e.itemId ? (items.get(e.itemId) ?? '') : '',
        note: e.note ?? '',
        amount: e.amount,
      })),
    );
  });

  protected readonly table = injectTable(() => ({
    features,
    columns,
    data: this.rows(),
    getRowId: (r: Row) => r.id,
    globalFilterFn: 'includesString' as const,
    state: { sorting: this.sorting(), globalFilter: this.search(), columnFilters: this.columnFilters() },
    onSortingChange: (u) => (typeof u === 'function' ? this.sorting.update(u) : this.sorting.set(u)),
    onColumnFiltersChange: (u) => (typeof u === 'function' ? this.columnFilters.update(u) : this.columnFilters.set(u)),
    onGlobalFilterChange: (u) => this.search.set(typeof u === 'function' ? u(this.search()) : u),
  }));

  protected readonly shownTotal = computed(() => {
    this.search();
    this.columnFilters();
    this.rows();
    return this.table.getRowModel().rows.reduce((s, r) => s + (r.original.kind === 'income' ? 0 : r.original.amount), 0);
  });

  protected setMonth(v: string) {
    this.monthFilter.set(v);
    this.columnFilters.set(v ? [{ id: 'month', value: Number(v) }] : []);
  }

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
