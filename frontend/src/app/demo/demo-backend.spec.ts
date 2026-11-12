import { DemoBackend, DemoError } from './demo-backend';

describe('DemoBackend', () => {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;

  it('serves a profile with last year and this year', () => {
    const b = new DemoBackend();
    const res = b.handle('GET', '/profile', null) as { profile: { years: number[]; accounts: unknown[] } };
    expect(res.profile.years).toEqual([y - 1, y]);
    expect(res.profile.accounts.length).toBe(3);
  });

  it("carries last year's result over as this year's opening and leaves this month uncounted", () => {
    const b = new DemoBackend();
    const cur = b.handle('GET', `/years/${y}`, null) as any;
    const prev = b.handle('GET', `/years/${y - 1}`, null) as any;
    const kind = new Map(prev.year.categories.map((c: any) => [c.id, c.kind]));
    const result = Object.values(prev.months).flat().reduce((s: number, e: any) => s + (kind.get(e.categoryId) === 'income' ? e.amount : -e.amount), 0) as number;
    expect(cur.year.opening).toBeCloseTo(prev.year.opening + result, 1);
    expect(cur.year.counts[m]).toBeUndefined();
    expect(cur.prevDecember).toBeTruthy();
  });

  it('adds an entry in memory and returns the month', () => {
    const b = new DemoBackend();
    const cat = (b.handle('GET', `/years/${y}`, null) as any).year.categories.find((c: any) => c.name === 'Groceries');
    const res = b.handle('POST', `/years/${y}/months/${m}/entries`, { categoryId: cat.id, amount: 12.5 }) as any;
    expect(res.months[m].some((e: any) => e.amount === 12.5 && e.categoryId === cat.id)).toBe(true);
  });

  it('refuses Google Sheet sync', () => {
    const b = new DemoBackend();
    expect(() => b.handle('PUT', '/settings', { sheetId: 'x' })).toThrow(DemoError);
  });

  it('starts fresh after reset', () => {
    const b = new DemoBackend();
    b.handle('POST', '/accounts', { name: 'Extra' });
    b.reset();
    expect((b.handle('GET', '/profile', null) as any).profile.accounts.length).toBe(3);
  });
});
