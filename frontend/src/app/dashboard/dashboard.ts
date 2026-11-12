import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronUp } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { FinanceStore } from '../core/finance.store';
import { MONTH_SHORT, formatMoney } from '../core/format';
import { countTotal, rowTotal } from '../core/ledger';
import { MONTHS } from '../core/models';
import { SummaryCards } from '../shared/summary-cards';

// Colours tuned for the dark theme (charts use ECharts' built-in 'dark' theme, see app.config.ts).
const INCOME = '#22c55e';
const EXPENSE = '#ef4444';
const STOCKS = '#3b82f6';
const PALETTE = ['#3b82f6', '#f59e0b', '#a78bfa', '#f472b6', '#2dd4bf', '#fb923c', '#94a3b8', '#a3e635', '#22d3ee', '#c084fc'];
const CARD_BG = '#18181b'; // matches --card in dark mode
/** Shared options so charts blend into the cards instead of using ECharts' own dark background. */
const BASE = { backgroundColor: 'transparent', textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" } };
const money = (v: number) => formatMoney(v);

@Component({
  selector: 'app-dashboard',
  imports: [NgxEchartsDirective, NgIcon, HlmButtonImports, HlmCardImports, SummaryCards],
  providers: [provideIcons({ lucideChevronDown, lucideChevronUp })],
  template: `
    <div class="grid gap-6">
      <app-summary-cards />
      @if (store.data()) {
        <div class="grid gap-6 lg:grid-cols-2">
          <section hlmCard class="lg:col-span-2">
            <div hlmCardHeader>
              <h2 hlmCardTitle>Income and expenses</h2>
              <p hlmCardDescription>Per month, {{ store.data()?.year?.year }}</p>
            </div>
            <div hlmCardContent><div echarts [options]="monthlyChart()" class="h-72 w-full"></div></div>
          </section>

          <section hlmCard>
            <div hlmCardHeader>
              <h2 hlmCardTitle>Expenses by group</h2>
              <p hlmCardDescription>Whole year</p>
            </div>
            <div hlmCardContent><div echarts [options]="groupChart()" class="h-80 w-full"></div></div>
          </section>

          <section hlmCard>
            <div hlmCardHeader>
              <h2 hlmCardTitle>Balance</h2>
              <p hlmCardDescription>{{ balanceMode() === 'lines' ? 'From your monthly counts' : 'What it is made of, per month' }}</p>
              <div hlmCardAction class="flex gap-1 rounded-lg bg-muted p-1 text-xs">
                @for (mode of balanceModes; track mode.value) {
                  <button type="button" class="rounded-md px-2.5 py-1 font-medium"
                          [class]="balanceMode() === mode.value ? 'bg-background shadow-sm' : 'text-muted-foreground'"
                          [attr.aria-pressed]="balanceMode() === mode.value" (click)="balanceMode.set(mode.value)">{{ mode.label }}</button>
                }
              </div>
            </div>
            <div hlmCardContent><div echarts [options]="balanceChart()" class="h-80 w-full"></div></div>
          </section>

          <section hlmCard class="lg:col-span-2">
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ showAllTop() ? 'All expense categories' : 'Top expense categories' }}</h2>
              <p hlmCardDescription>Whole year · {{ topShown().length }} of {{ topAll().length }}</p>
              @if (topAll().length > TOP_N) {
                <div hlmCardAction>
                  <button hlmBtn variant="outline" size="sm" (click)="showAllTop.set(!showAllTop())">
                    <ng-icon [name]="showAllTop() ? 'lucideChevronUp' : 'lucideChevronDown'" />
                    {{ showAllTop() ? 'Show top ' + TOP_N : 'Show all (' + topAll().length + ')' }}
                  </button>
                </div>
              }
            </div>
            <div hlmCardContent><div echarts [options]="topChart()" class="w-full" [style.height.px]="topHeight()"></div></div>
          </section>
        </div>
      }
    </div>
  `,
})
export class Dashboard {
  protected readonly store = inject(FinanceStore);
  private readonly t = computed(() => this.store.totals());
  private readonly labels = MONTH_SHORT;

  protected readonly monthlyChart = computed<EChartsCoreOption>(() => {
    const t = this.t();
    if (!t) return {};
    const series = (name: string, data: number[], color: string) => ({
      name,
      type: 'bar',
      data: MONTHS.map((m) => Math.round(data[m]! * 100) / 100),
      itemStyle: { color, borderRadius: [3, 3, 0, 0] },
    });
    return {
      ...BASE,
      tooltip: { trigger: 'axis', valueFormatter: money },
      legend: { bottom: 0 },
      grid: { left: 8, right: 8, top: 16, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: this.labels },
      yAxis: { type: 'value', axisLabel: { formatter: money } },
      series: [series('Income', t.income, INCOME), series('Expenses', t.expenses, EXPENSE)],
    };
  });

  protected readonly groupChart = computed<EChartsCoreOption>(() => {
    const t = this.t();
    if (!t) return {};
    const data = this.store
      .expenseGroups()
      .map((g) => ({ name: g.group, value: Math.round(g.categories.reduce((s, c) => s + rowTotal(t.byCategory.get(c.id)), 0) * 100) / 100 }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    return {
      ...BASE,
      color: PALETTE,
      tooltip: { trigger: 'item', valueFormatter: money },
      legend: { bottom: 0, type: 'scroll' },
      series: [{ type: 'pie', radius: ['45%', '72%'], center: ['50%', '45%'], itemStyle: { borderColor: CARD_BG, borderWidth: 2, borderRadius: 4 }, label: { show: false }, data }],
    };
  });

  protected readonly balanceModes = [
    { value: 'lines', label: 'Lines' },
    { value: 'stacked', label: 'Stacked' },
  ] as const;
  protected readonly balanceMode = signal<'lines' | 'stacked'>('lines');

  protected readonly balanceChart = computed<EChartsCoreOption>(() => {
    const d = this.store.data();
    if (!d) return {};
    if (this.balanceMode() === 'stacked') return this.stackedBalance(d);
    // Total = all accounts counted that month; + stocks adds the stocks value counted that month.
    const total = MONTHS.map((m) => countTotal(d.year.counts[m]) ?? null);
    const withStocks = MONTHS.map((m, i) => (total[i] === null ? null : Math.round((total[i]! + (d.year.counts[m]?.stocksValue ?? 0)) * 100) / 100));
    return {
      ...BASE,
      tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v === null ? '—' : money(v)) },
      legend: { bottom: 0 },
      grid: { left: 8, right: 8, top: 16, bottom: 40, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: this.labels },
      yAxis: { type: 'value', axisLabel: { formatter: money } },
      series: [
        { name: 'Total', type: 'line', smooth: true, data: total, connectNulls: true, lineStyle: { color: INCOME, width: 2 }, itemStyle: { color: INCOME }, areaStyle: { color: INCOME, opacity: 0.1 } },
        { name: 'Total + stocks', type: 'line', smooth: true, data: withStocks, connectNulls: true, lineStyle: { color: STOCKS, width: 2 }, itemStyle: { color: STOCKS } },
      ],
    };
  });

  /** Stacked bars: each account's counted balance plus the stocks value, per month. */
  private stackedBalance(d: NonNullable<ReturnType<FinanceStore['data']>>): EChartsCoreOption {
    const used = this.store.accounts().filter((a) => MONTHS.some((m) => d.year.counts[m]?.balances?.[a.id] !== undefined));
    const bar = (name: string, color: string, value: (m: number) => number | undefined) => ({
      name,
      type: 'bar',
      stack: 'balance',
      barMaxWidth: 36,
      itemStyle: { color },
      data: MONTHS.map((m) => (d.year.counts[m] ? (value(m) ?? 0) : null)),
    });
    const series = [
      ...used.map((a, i) => bar(a.name, PALETTE[(i + 1) % PALETTE.length]!, (m) => d.year.counts[m]?.balances?.[a.id])),
      bar('Stocks value', STOCKS, (m) => d.year.counts[m]?.stocksValue),
    ];
    return {
      ...BASE,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: { marker: string; seriesName: string; value: number | null; axisValue: string }[]) => {
          const rows = params.filter((p) => p.value);
          if (!rows.length) return `${params[0]?.axisValue ?? ''}<br/>Not counted`;
          const total = rows.reduce((s, p) => s + (p.value ?? 0), 0);
          return [`<b>${params[0]!.axisValue}</b>`, ...rows.map((p) => `${p.marker} ${p.seriesName}: ${money(p.value!)}`), `<b>Total: ${money(total)}</b>`].join('<br/>');
        },
      },
      legend: { bottom: 0, type: 'scroll' },
      grid: { left: 8, right: 8, top: 16, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: this.labels },
      yAxis: { type: 'value', axisLabel: { formatter: money } },
      series,
    };
  }

  // ----- top expense categories -----
  protected readonly TOP_N = 12;
  protected readonly showAllTop = signal(false);
  protected readonly topAll = computed(() => {
    const t = this.t();
    if (!t) return [];
    return this.store
      .categories()
      .filter((c) => c.kind === 'expense')
      .map((c) => ({ name: c.name, value: rowTotal(t.byCategory.get(c.id)) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
  });
  protected readonly topShown = computed(() => (this.showAllTop() ? this.topAll() : this.topAll().slice(0, this.TOP_N)));
  /** Grow the chart with the number of bars so every label stays readable. */
  protected readonly topHeight = computed(() => Math.max(240, this.topShown().length * 28 + 40));

  protected readonly topChart = computed<EChartsCoreOption>(() => {
    const rows = [...this.topShown()].reverse();
    if (!rows.length) return {};
    return {
      ...BASE,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: money },
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: money } },
      yAxis: { type: 'category', data: rows.map((r) => r.name) },
      series: [{ type: 'bar', data: rows.map((r) => r.value), itemStyle: { color: EXPENSE, borderRadius: [0, 3, 3, 0] } }],
    };
  });
}
