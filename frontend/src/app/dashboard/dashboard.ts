import { Component, computed, inject } from '@angular/core';
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
  imports: [NgxEchartsDirective, HlmCardImports, SummaryCards],
  template: `
    <div class="grid gap-6">
      <app-summary-cards />
      @if (store.data()) {
        <div class="grid gap-6 lg:grid-cols-2">
          <section hlmCard class="lg:col-span-2">
            <div hlmCardHeader>
              <h2 hlmCardTitle>Income, expenses and stocks</h2>
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
              <p hlmCardDescription>Expected from your numbers vs. what you counted</p>
            </div>
            <div hlmCardContent><div echarts [options]="balanceChart()" class="h-80 w-full"></div></div>
          </section>

          <section hlmCard class="lg:col-span-2">
            <div hlmCardHeader>
              <h2 hlmCardTitle>Top expense categories</h2>
              <p hlmCardDescription>Whole year</p>
            </div>
            <div hlmCardContent><div echarts [options]="topChart()" class="h-96 w-full"></div></div>
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
      series: [series('Income', t.income, INCOME), series('Expenses', t.expenses, EXPENSE), series('Stocks', t.stocks, STOCKS)],
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

  protected readonly balanceChart = computed<EChartsCoreOption>(() => {
    const d = this.store.data();
    const t = this.t();
    if (!d || !t) return {};
    let running = d.year.opening;
    const expected = MONTHS.map((m) => Math.round((running += t.result[m]!) * 100) / 100);
    const counted = MONTHS.map((m) => countTotal(d.year.counts[m]) ?? null);
    return {
      ...BASE,
      tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v === null ? '—' : money(v)) },
      legend: { bottom: 0 },
      grid: { left: 8, right: 8, top: 16, bottom: 40, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: this.labels },
      yAxis: { type: 'value', axisLabel: { formatter: money } },
      series: [
        { name: 'Expected', type: 'line', smooth: true, data: expected, lineStyle: { color: INCOME, width: 2 }, itemStyle: { color: INCOME }, areaStyle: { color: INCOME, opacity: 0.1 } },
        { name: 'Counted', type: 'line', data: counted, connectNulls: true, lineStyle: { color: '#f59e0b', width: 2, type: 'dashed' }, itemStyle: { color: '#f59e0b' } },
      ],
    };
  });

  protected readonly topChart = computed<EChartsCoreOption>(() => {
    const t = this.t();
    if (!t) return {};
    const rows = this.store
      .categories()
      .filter((c) => c.kind === 'expense')
      .map((c) => ({ name: c.name, value: rowTotal(t.byCategory.get(c.id)) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)
      .reverse();
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
