import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck, lucideTriangleAlert } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { monthName } from '../core/format';
import { round2, untracedSuggestion } from '../core/ledger';

/** Untraced corrections at or above this size get a "double-check" warning. */
const LARGE_UNTRACED = 50;

type Check = NonNullable<ReturnType<typeof untracedSuggestion>>;

/**
 * Monthly count: enter what each account really holds. On save, the app compares the counted
 * change with what was recorded and asks to confirm the "Untraced" correction that makes the
 * numbers match — warning when it's unusually large (a sign of a missing entry or typo).
 */
@Component({
  selector: 'app-count-panel',
  imports: [DecimalPipe, FormsModule, NgIcon, HlmButtonImports, HlmInputImports, HlmLabelImports],
  providers: [provideIcons({ lucideCircleCheck, lucideTriangleAlert })],
  template: `
    @if (!store.activeAccounts().length) {
      <p class="text-sm text-muted-foreground">Add your accounts under <strong>Categories → Accounts</strong> first.</p>
    } @else if (confirm(); as c) {
      <!-- Step 2: confirm the untraced correction -->
      <div class="grid gap-4">
        <div class="rounded-lg p-4 text-center" [class]="isLarge(c) ? 'bg-destructive/15' : 'bg-muted'">
          <p class="text-sm text-muted-foreground">Required untraced for {{ monthName(month()) }}</p>
          <p class="sensitive text-3xl font-semibold tabular-nums">€{{ c.suggestion | number: '1.2-2' }}</p>
          <p class="text-xs text-muted-foreground">
            {{ c.suggestion > 0 ? 'Money is missing compared to what you recorded.' : c.suggestion < 0 ? 'You have more money than you recorded.' : 'Your records match the count exactly.' }}
          </p>
        </div>

        @if (isLarge(c)) {
          <p class="flex gap-2 rounded-md border border-destructive/40 p-3 text-sm">
            <ng-icon name="lucideTriangleAlert" class="mt-0.5 shrink-0 text-destructive" />
            <span>That's a large difference. Double-check the balances you typed and whether an expense or income
              this month is missing before applying it.</span>
          </p>
        }

        <div class="grid gap-1 text-sm">
          <p class="flex justify-between"><span class="text-muted-foreground">Counted now</span><span class="tabular-nums">{{ c.now | number: '1.2-2' }}</span></p>
          <p class="flex justify-between"><span class="text-muted-foreground">Counted {{ prevLabel() }}</span><span class="tabular-nums">{{ c.prev | number: '1.2-2' }}</span></p>
          <p class="flex justify-between"><span class="text-muted-foreground">Change counted</span><span class="tabular-nums">{{ c.counted | number: '1.2-2' }}</span></p>
          <p class="flex justify-between"><span class="text-muted-foreground">Change recorded (without untraced)</span><span class="tabular-nums">{{ c.recorded | number: '1.2-2' }}</span></p>
          <p class="flex justify-between border-t pt-1"><span class="text-muted-foreground">Untraced recorded now</span><span class="tabular-nums">{{ c.current | number: '1.2-2' }}</span></p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button hlmBtn class="flex-1" [disabled]="saving()" (click)="applyUntraced(c.suggestion)">
            Apply <span class="sensitive">€{{ c.suggestion | number: '1.2-2' }}</span>
          </button>
          <button hlmBtn variant="outline" class="flex-1" [disabled]="saving()" (click)="confirm.set(null)">Back to the count</button>
        </div>
        <button hlmBtn variant="ghost" size="sm" [disabled]="saving()" (click)="skip()">Leave untraced as it is</button>
      </div>
    } @else {
      <!-- Step 1: enter balances -->
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
            @if (matches(c)) {
              <p class="flex items-center gap-1.5 text-green-500"><ng-icon name="lucideCircleCheck" /> Untraced matches the saved count.</p>
            } @else {
              <p class="text-muted-foreground">Untraced doesn't match the saved count yet — save to review it.</p>
            }
          } @else if (!hasPrev()) {
            <p class="text-muted-foreground">No count for {{ prevLabel() }}, so the untraced amount can't be worked out.</p>
          }
        </div>

        <button hlmBtn type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save count' }}</button>
      </form>
    }
  `,
})
export class CountPanel {
  private readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);
  protected readonly monthName = monthName;

  readonly month = input.required<number>();
  readonly done = output<void>();

  protected readonly balances = signal<Record<string, number | null>>({});
  protected readonly stocksValue = signal<number | null>(null);
  protected readonly saving = signal(false);
  /** Set after saving when the untraced amount needs confirming. */
  protected readonly confirm = signal<Check | null>(null);

  protected readonly draftTotal = computed(() =>
    round2(Object.values(this.balances()).reduce<number>((s, v) => s + (Number(v) || 0), 0)),
  );
  /** Based on saved counts (so it matches the year view and the sheet). */
  protected readonly check = computed(() => {
    const d = this.store.data();
    const t = this.store.totals();
    return d && t ? untracedSuggestion(d, t, this.month()) : null;
  });
  protected readonly prevLabel = computed(() => (this.month() > 1 ? monthName(this.month() - 1) : 'last December'));
  protected readonly hasPrev = computed(() => {
    const d = this.store.data();
    return !!(this.month() > 1 ? d?.year.counts[this.month() - 1] : d?.prevDecember);
  });

  constructor() {
    effect(() => {
      const c = this.store.data()?.year.counts[this.month()];
      this.balances.set(Object.fromEntries(this.store.activeAccounts().map((a) => [a.id, c?.balances[a.id] ?? null])));
      this.stocksValue.set(c?.stocksValue ?? null);
    });
    // Switching month (arrows in the dialog) leaves the confirmation step.
    effect(() => {
      this.month();
      this.confirm.set(null);
    });
  }

  protected matches = (c: Check) => Math.abs(c.suggestion - c.current) < 0.01;
  protected isLarge = (c: Check) => Math.abs(c.suggestion) >= LARGE_UNTRACED;

  protected setBalance(id: string, v: unknown) {
    this.balances.update((b) => ({ ...b, [id]: v === '' || v === null || v === undefined ? null : Number(v) }));
  }

  protected async save() {
    this.saving.set(true);
    try {
      const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
      const balances = Object.fromEntries(Object.entries(this.balances()).map(([k, v]) => [k, num(v)]));
      this.store.applyYear(await this.api.saveCount(this.store.y, this.month(), { balances, stocksValue: num(this.stocksValue()) }));

      // With the new count saved, check whether untraced still makes the numbers add up.
      const c = this.check();
      if (c && !this.matches(c)) this.confirm.set(c);
      else if (c) {
        toast.success('Count saved — untraced already matches');
        this.done.emit();
      } else {
        toast.success('Count saved');
        this.done.emit();
      }
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
      toast.success(`Count saved · untraced set to ${amount.toFixed(2)}`);
      this.done.emit();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected skip() {
    toast.success('Count saved · untraced left unchanged');
    this.done.emit();
  }
}
