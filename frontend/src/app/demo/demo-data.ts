// Made-up data for the public demo: last year (full) and this year up to the current month.
// Deterministic (seeded) so every visitor sees the same numbers.
import type { Account, Category, Entry, Fund, Item, Profile, YearDoc } from '../core/models';

export interface DemoState {
  profile: Profile;
  years: Map<number, { year: YearDoc; months: Record<number, Entry[]> }>;
}

export function createDemoState(): DemoState {
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const amt = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  let n = 0;
  const id = () => `d${(n++).toString(36)}`;

  // Categories (same ids in both years, like a year copied from the previous one).
  const cats: Category[] = [];
  const add = (name: string, kind: Category['kind'], group: string) => {
    const c: Category = { id: id(), name, kind, group, order: cats.length };
    cats.push(c);
    return c;
  };
  const salary = add('Salary', 'income', 'Income');
  const vouchers = add('Meal vouchers', 'income', 'Income');
  const otherIncome = add('Other income', 'income', 'Income');
  const E = (name: string, group: string) => add(name, 'expense', group);
  const rent = E('Rent', 'Bills'), power = E('Electricity', 'Bills'), water = E('Water', 'Bills'), phone = E('Phone & internet', 'Bills');
  const groceries = E('Groceries', 'Home & food'), home = E('Home', 'Home & food'), delivery = E('Food delivery', 'Home & food');
  const car = E('Car', 'Transport'), fuel = E('Fuel', 'Transport'), metro = E('Public transport', 'Transport');
  const hobbies = E('Hobbies', 'Personal'), clothes = E('Clothes', 'Personal'), games = E('Games', 'Personal');
  const trips = E('Trips', 'Trips & going out'), goingOut = E('Going out', 'Trips & going out');
  const pharmacy = E('Pharmacy', 'Health & other'), misc = E('Misc', 'Health & other'), untraced = E('Untraced', 'Health & other');
  untraced.role = 'untraced';
  const stocks = add('Stocks', 'stocks', 'Stocks');
  const kindOf = new Map(cats.map((c) => [c.id, c.kind]));

  const accounts: Account[] = [
    { id: 'acc-bank', name: 'Bank', order: 0 },
    { id: 'acc-revolut', name: 'Revolut', order: 1 },
    { id: 'acc-cash', name: 'Cash', order: 2 },
  ];

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const tripNames = ['Lisbon weekend', 'Island summer trip', 'Mountain cabin', 'Rome city break', 'Beach camping', 'Prague in winter'];
  const years: DemoState['years'] = new Map();
  let opening = 1850;
  let cash = opening;

  for (const year of [thisYear - 1, thisYear]) {
    const lastMonth = year === thisYear ? thisMonth : 12;
    const items: Item[] = [3, 7, 10]
      .filter((m) => m <= lastMonth)
      .map((m, i) => ({ id: id(), categoryId: trips.id, name: tripNames[(year % 2) * 3 + i]!, month: m }));
    const months: Record<number, Entry[]> = {};
    const counts: YearDoc['counts'] = {};
    const yearOpening = opening;

    for (let m = 1; m <= 12; m++) {
      const e: Entry[] = [];
      const push = (c: Category, amount: number, extra: Partial<Entry> = {}) => e.push({ id: id(), categoryId: c.id, amount, ...extra });
      if (m <= lastMonth) {
        push(salary, m === 7 || m === 12 ? 3400 : 2150, { note: m === 7 || m === 12 ? 'Salary + bonus' : undefined });
        push(vouchers, 130);
        if (m % 4 === 0) push(otherIncome, amt(40, 300), { note: 'Sold old stuff' });
        push(rent, 700);
        push(power, amt(45, 120));
        if (m % 3 === 0) push(water, amt(25, 45));
        push(phone, 39.9);
        for (let i = 0; i < 5; i++) push(groceries, amt(15, 70), { note: i === 0 ? 'Supermarket' : undefined });
        push(home, amt(10, 90));
        for (let i = 0; i < 3; i++) push(delivery, amt(9, 25));
        push(delivery, -8, { note: 'Friend paid me back' });
        if (m % 5 === 0) push(car, amt(150, 400), { note: 'Service' });
        push(fuel, amt(40, 70));
        for (let i = 0; i < 6; i++) push(metro, 1.2);
        push(hobbies, amt(10, 60));
        if (m % 2) push(clothes, amt(30, 120));
        push(games, amt(5, 40));
        for (let i = 0; i < 4; i++) push(goingOut, amt(8, 45));
        if (m % 3 === 1) push(pharmacy, amt(6, 30));
        push(misc, amt(5, 50));
        const trip = items.find((x) => x.month === m);
        if (trip) {
          const notes = ['Flights', 'Hotel', 'Dinner', 'Museum', 'Taxi', 'Souvenirs'];
          notes.forEach((note) => push(trips, amt(20, 160), { itemId: trip.id, note }));
        }
        if (m >= 3) push(stocks, 100);
        push(untraced, amt(-10, 15), { note: 'Monthly count correction' });

        const result = e.reduce((s, x) => s + (kindOf.get(x.categoryId) === 'income' ? x.amount : -x.amount), 0);
        cash += result;
        // Counts for finished months (this month is left open so visitors can try the monthly count).
        if (!(year === thisYear && m === thisMonth)) {
          const c = Math.round(cash * 100) / 100;
          counts[m] = {
            balances: { 'acc-bank': Math.round(c * 80) / 100, 'acc-revolut': Math.round(c * 15) / 100, 'acc-cash': Math.round((c - Math.round(c * 80) / 100 - Math.round(c * 15) / 100) * 100) / 100 },
            stocksValue: m >= 3 || year < thisYear ? Math.round((year < thisYear ? m - 2 : m + 8) * 104 * 100) / 100 : undefined,
          };
        }
      }
      months[m] = e;
    }
    years.set(year, { year: { year, opening: yearOpening, categories: structuredClone(cats), items, counts }, months });
    opening = Math.round(cash * 100) / 100;
  }

  const funds: Fund[] = [
    {
      id: 'fund-house',
      name: 'House deposit',
      order: 0,
      entries: [
        { id: id(), amount: 20000, note: 'Savings moved in', date: `${thisYear}-01-10` },
        { id: id(), amount: -1500, note: 'Lawyer', date: `${thisYear}-02-02` },
        { id: id(), amount: -900, note: 'Engineer survey', date: `${thisYear}-02-20` },
      ],
    },
    {
      id: 'fund-gift',
      name: 'Gift card',
      order: 1,
      entries: [
        { id: id(), amount: 100, note: 'Top-up', date: `${thisYear}-01-01` },
        { id: id(), amount: -64.3, note: 'Spent', date: `${thisYear}-01-15` },
      ],
    },
  ];

  return { profile: { years: [thisYear - 1, thisYear], accounts, funds }, years };
}
