import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChartCandlestick, lucideTrendingDown, lucideTrendingUp, lucideWallet } from '@ng-icons/lucide';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { CURRENCY } from '../core/format';
import { FinanceStore } from '../core/finance.store';

/** Year totals: income, expenses, stocks, and the result including the carry-over. */
@Component({
  selector: 'app-summary-cards',
  imports: [CurrencyPipe, NgIcon, HlmCardImports, HlmSkeletonImports],
  providers: [provideIcons({ lucideTrendingUp, lucideTrendingDown, lucideChartCandlestick, lucideWallet })],
  template: `
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      @for (c of cards(); track c.label) {
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <p hlmCardDescription class="flex items-center gap-1.5"><ng-icon [name]="c.icon" /> {{ c.label }}</p>
            @if (store.loading() && !store.data()) {
              <hlm-skeleton class="h-8 w-28" />
            } @else {
              <p hlmCardTitle class="tabular-nums">
                <span class="text-xl font-semibold sm:text-2xl" [class]="c.class">{{ c.value | currency: currency : 'symbol' : '1.0-0' }}</span>
              </p>
              @if (c.hint) { <p class="sensitive text-xs text-muted-foreground">{{ c.hint }}</p> }
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class SummaryCards {
  protected readonly store = inject(FinanceStore);
  protected readonly currency = CURRENCY;
  protected readonly cards = computed(() => {
    const t = this.store.totals();
    const d = this.store.data();
    const y = t?.year ?? { income: 0, expenses: 0, stocks: 0, result: 0, final: 0 };
    return [
      { label: 'Income', icon: 'lucideTrendingUp', value: y.income, class: 'text-green-500', hint: '' },
      { label: 'Expenses', icon: 'lucideTrendingDown', value: y.expenses, class: 'text-red-400', hint: '' },
      { label: 'Stocks', icon: 'lucideChartCandlestick', value: y.stocks, class: '', hint: '' },
      {
        label: 'Result',
        icon: 'lucideWallet',
        value: y.final,
        class: y.final < 0 ? 'text-red-400' : '',
        hint: d ? `incl. ${Math.round(d.year.opening).toLocaleString('en-IE')} from ${d.year.year - 1}` : '',
      },
    ];
  });
}
