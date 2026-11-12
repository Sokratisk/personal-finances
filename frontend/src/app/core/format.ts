/** Shared formatters (also used by charts, which can't use Angular pipes). */
export const CURRENCY = 'EUR';

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: CURRENCY });
const plain = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** €1,234.56 */
export const formatMoney = (n: number) => money.format(n);
/** 1,234.56 (no symbol — for dense tables) */
export const formatNumber = (n: number) => plain.format(n);
/** 3 → "March" */
export const monthName = (m: number) => MONTH_NAMES[m - 1] ?? '';
