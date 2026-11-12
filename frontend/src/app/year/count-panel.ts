import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { round2, untracedSuggestion } from '../core/ledger';

/**
 * Monthly count: enter what each account really holds; the app compares the change with what
 * was recorded and suggests the "Untraced" correction for missing (or extra) money.
 */
@Component({
  selector: 'app-count-panel',
  imports: [DecimalPipe, FormsModule, HlmButtonImports, HlmInputImports, HlmLabelImports],
  template: `
    @if (!store.activeAccounts().length) {
      <p class="text-sm text-muted-foreground">Add your accounts under <strong>Categories → Accounts</strong> first.</p>
    } @else {
      <form (ngSubmit)="save()" class="grid gap-4">
        <div class="grid gap-2">
          @for (a of store.activeAccounts(); track a.id) {
            <div class="grid grid-cols-[1fr_9rem] items-center gap-3">
              <label hlmLabel [for]="'acc-' + a.id">{{ a.name }}</label>
              <input hlmInput type="number" step="0.01" inputmode="decimal" class="text-right" [id]="'acc-' + a.id"
                     [name]="a.id" [ngModel]="balances()[a.id]" (ngModelChange)="setBalance(a.id, $event)" />
            </div>
          }
          <div class="grid grid-cols-[1fr_9rem] items-center gap-3 border-t pt-2">
            <label hlmLabel for="acc-stocks">Stocks value <span class="text-muted-foreground">(not counted as cash)</span></label>
            <input hlmInput type="number" step="0.01" inputmode="decimal" class="text-right" id="acc-stocks" name="stocks"
                   [(ngModel)]="stocksValue" />
          </div>
        </div>

        <div class="grid gap-1 rounded-lg bg-muted p-3 text-sm">
          <p class="flex justify-between"><span>Counted total</span><span class="tabular-nums font-medium">€{{ draftTotal() | number: '1.2-2' }}</span></p>
          @if (check(); as c) {
            <p class="flex justify-between text-muted-foreground"><span>Change since {{ prevLabel() }}</span><span class="tabular-nums">{{ c.counted | number: '1.2-2' }}</span></p>
            <p class="flex justify-between text-muted-foreground"><span>Recorded this month (without untraced)</span><span class="tabular-nums">{{ c.recorded | number: '1.2-2' }}</span></p>
            <p class="mt-1 flex justify-between border-t pt-1 font-medium">
              <span>Suggested untraced</span><span class="tabular-nums">{{ c.suggestion | number: '1.2-2' }}</span>
            </p>
            <p class="flex justify-between text-muted-foreground"><span>Untraced recorded now</span><span class="tabular-nums">{{ c.current | number: '1.2-2' }}</span></p>
          } @else {
            <p class="text-muted-foreground">Save counts for this and the previous month to get an untraced suggestion.</p>
          }
        </div>

        <div class="flex flex-wrap gap-2">
          <button hlmBtn type="submit" class="flex-1" [disabled]="saving()">Save count</button>
          @if (check(); as c) {
            <button hlmBtn type="button" variant="outline" class="flex-1" [disabled]="saving() || c.suggestion === c.current"
                    (click)="applyUntraced(c.suggestion)">
              Set untraced to <span class="sensitive">{{ c.suggestion | number: '1.2-2' }}</span>
            </button>
          }
        </div>
      </form>
    }
  `,
})
export class CountPanel {
  private readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);

  readonly month = input.required<number>();
  readonly done = output<void>();

  protected readonly balances = signal<Record<string, number | null>>({});
  protected stocksValue: number | null = null;
  protected readonly saving = signal(false);

  protected readonly draftTotal = computed(() =>
    round2(Object.values(this.balances()).reduce<number>((s, v) => s + (Number(v) || 0), 0)),
  );
  /** Suggestion is based on saved counts (so it matches what the sheet shows). */
  protected readonly check = computed(() => {
    const d = this.store.data();
    const t = this.store.totals();
    return d && t ? untracedSuggestion(d, t, this.month()) : null;
  });
  protected readonly prevLabel = computed(() => (this.month() > 1 ? 'last month' : '—'));

  constructor() {
    effect(() => {
      const c = this.store.data()?.year.counts[this.month()];
      this.balances.set(Object.fromEntries(this.store.activeAccounts().map((a) => [a.id, c?.balances[a.id] ?? null])));
      this.stocksValue = c?.stocksValue ?? null;
    });
  }

  protected setBalance(id: string, v: unknown) {
    this.balances.update((b) => ({ ...b, [id]: v === '' || v === null || v === undefined ? null : Number(v) }));
  }

  protected async save() {
    this.saving.set(true);
    try {
      const balances = Object.fromEntries(Object.entries(this.balances()).map(([k, v]) => [k, v === null || v === undefined || (v as unknown) === '' ? null : Number(v)]));
      this.store.applyYear(await this.api.saveCount(this.store.y, this.month(), { balances, stocksValue: this.stocksValue === null ? null : Number(this.stocksValue) }));
      toast.success('Count saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected async applyUntraced(amount: number) {
    this.saving.set(true);
    try {
      this.store.applyMonths(await this.api.setUntraced(this.store.y, this.month(), amount));
      toast.success(`Untraced set to ${amount.toFixed(2)}`);
      this.done.emit();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
