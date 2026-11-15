import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FinanceStore } from './finance.store';
import type { Entry, YearData } from './models';

// Tiny year: salary + groceries + untraced; February and March are counted.
function year(): YearData {
  const e = (id: string, categoryId: string, amount: number): Entry => ({ id, categoryId, amount });
  return {
    year: {
      year: 2026,
      opening: 0,
      categories: [
        { id: 'sal', name: 'Salary', kind: 'income', group: 'Income', order: 0 },
        { id: 'gro', name: 'Groceries', kind: 'expense', group: 'Home', order: 1 },
        { id: 'unt', name: 'Untraced', kind: 'expense', group: 'Other', order: 2, role: 'untraced' },
      ],
      items: [],
      counts: { '2': { balances: { bank: 1000 } }, '3': { balances: { bank: 1200 } } },
    },
    // March: +500 income, −200 groceries, −100 untraced → result +200 = counted change (1200 − 1000). It matches.
    months: { 1: [], 2: [], 3: [e('s', 'sal', 500), e('g', 'gro', 200), e('u', 'unt', 100)], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [], 10: [], 11: [], 12: [] },
  };
}

describe('FinanceStore — counted months stay consistent', () => {
  let store: FinanceStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    store = TestBed.inject(FinanceStore);
    store.data.set(year());
  });

  it('asks to lower untraced when an expense is added to a counted month', () => {
    const march = [...store.data()!.months[3]!, { id: 'p', categoryId: 'gro', amount: 30 }];
    store.applyMonths({ months: { 3: march } });
    expect(store.untracedPrompts()).toEqual([{ year: 2026, month: 3, from: 100, to: 70 }]);
  });

  it('does not ask when only untraced itself changes', () => {
    const march = store.data()!.months[3]!.map((e) => (e.id === 'u' ? { ...e, amount: 90 } : e));
    store.applyMonths({ months: { 3: march } });
    expect(store.untracedPrompts()).toEqual([]);
  });

  it('does not ask for a month that has no count', () => {
    store.applyMonths({ months: { 4: [{ id: 'x', categoryId: 'gro', amount: 30 }] } });
    expect(store.untracedPrompts()).toEqual([]);
  });
});
