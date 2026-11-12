import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { groupExpenses } from '../core/ledger';
import type { Category } from '../core/models';

/** Start a new year: carry over the balance and pick which categories to keep. */
@Component({
  selector: 'app-new-year-panel',
  imports: [FormsModule, HlmButtonImports, HlmFieldImports, HlmInputImports, HlmLabelImports],
  template: `
    <form (ngSubmit)="create()" class="grid gap-4">
      <div class="grid grid-cols-2 gap-3">
        <div hlmField>
          <label hlmLabel for="ny-year">Year</label>
          <input hlmInput id="ny-year" name="year" type="number" required [(ngModel)]="year" />
        </div>
        <div hlmField>
          <label hlmLabel for="ny-opening">Carried over (€)</label>
          <input hlmInput id="ny-opening" name="opening" type="number" step="0.01" [(ngModel)]="opening" />
        </div>
      </div>

      @if (source(); as src) {
        <div>
          <div class="mb-2 flex items-center justify-between">
            <p class="text-sm font-medium">Categories to copy from {{ src }}</p>
            <div class="flex gap-1">
              <button hlmBtn type="button" variant="ghost" size="xs" (click)="setAll(true)">All</button>
              <button hlmBtn type="button" variant="ghost" size="xs" (click)="setAll(false)">None</button>
            </div>
          </div>
          <div class="grid max-h-72 gap-3 overflow-y-auto rounded-md border p-3">
            @for (g of groups(); track g.label) {
              <div>
                <p class="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{{ g.label }}</p>
                <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                  @for (c of g.categories; track c.id) {
                    <label class="flex items-center gap-2 text-sm">
                      <input type="checkbox" class="accent-primary" [checked]="picked().has(c.id)" (change)="toggle(c.id)" />
                      {{ c.name }}
                    </label>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }

      <button hlmBtn type="submit" [disabled]="saving()">{{ saving() ? 'Creating…' : 'Create ' + year() }}</button>
    </form>
  `,
})
export class NewYearPanel {
  private readonly api = inject(ApiService);
  private readonly store = inject(FinanceStore);
  readonly created = output<void>();

  /** Latest existing year = where categories and the carry-over come from. */
  protected readonly source = computed(() => this.store.years().at(-1) ?? null);
  private readonly sourceCats = computed<Category[]>(() => {
    const d = this.store.data();
    return d && d.year.year === this.source() ? d.year.categories.filter((c) => !c.archived) : [];
  });
  protected readonly groups = computed(() => {
    const cats = [...this.sourceCats()].sort((a, b) => a.order - b.order);
    return [
      { label: 'Income', categories: cats.filter((c) => c.kind === 'income') },
      ...groupExpenses(cats).map((g) => ({ label: g.group, categories: g.categories })),
      { label: 'Stocks', categories: cats.filter((c) => c.kind === 'stocks') },
    ].filter((g) => g.categories.length);
  });
  protected readonly picked = signal(new Set<string>());
  protected readonly saving = signal(false);
  protected readonly year = signal(new Date().getFullYear() + 1);
  protected readonly opening = signal(0);

  constructor() {
    effect(() => {
      const src = this.source();
      this.year.set(src ? src + 1 : new Date().getFullYear());
      const d = this.store.data();
      const t = this.store.totals();
      this.opening.set(d && t && d.year.year === src ? t.year.final : 0);
      this.picked.set(new Set(this.sourceCats().map((c) => c.id)));
    });
  }

  protected toggle(id: string) {
    this.picked.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected setAll(on: boolean) {
    this.picked.set(new Set(on ? this.sourceCats().map((c) => c.id) : []));
  }

  protected async create() {
    this.saving.set(true);
    try {
      const src = this.source();
      const res = await this.api.createYear({
        year: Number(this.year()),
        opening: Number(this.opening()) || 0,
        copyFrom: src && this.sourceCats().length ? src : undefined,
        categoryIds: src ? [...this.picked()] : undefined,
      });
      this.store.applyProfile(res);
      await this.store.selectYear(res.year.year);
      toast.success(`${res.year.year} created`);
      this.created.emit();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
