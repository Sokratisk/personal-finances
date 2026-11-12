import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { firestore } from '../firestore';
import { requireAuth } from '../middleware/auth';

export interface Transaction {
  id?: string;
  description: string;
  /** Positive = income, negative = expense. */
  amount: number;
  category: string;
  /** ISO date, yyyy-mm-dd. */
  date: string;
}

// Each user's data lives under users/{uid}/transactions, so users never see each other's data.
const userDoc = (uid: string) => `users/${uid}`;

function parseTransaction(body: unknown): Transaction {
  const b = (body ?? {}) as Partial<Transaction>;
  if (typeof b.description !== 'string' || !b.description.trim())
    throw new HTTPException(400, { message: 'description is required' });
  if (typeof b.amount !== 'number' || !Number.isFinite(b.amount))
    throw new HTTPException(400, { message: 'amount must be a number' });
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date))
    throw new HTTPException(400, { message: 'date must be yyyy-mm-dd' });
  return {
    description: b.description.trim(),
    amount: b.amount,
    category: typeof b.category === 'string' && b.category.trim() ? b.category.trim() : 'Other',
    date: b.date,
  };
}

const toTransaction = ({ id, data }: { id: string; data: Record<string, unknown> }): Transaction => ({
  id,
  description: String(data.description ?? ''),
  amount: Number(data.amount ?? 0),
  category: String(data.category ?? 'Other'),
  date: String(data.date ?? ''),
});

export const transactions = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => {
    const docs = await firestore(c.env).list(userDoc(c.get('uid')), 'transactions', {
      orderBy: 'date',
      desc: true,
      limit: 500,
    });
    return c.json(docs.map(toTransaction));
  })
  .post('/', async (c) => {
    const tx = parseTransaction(await c.req.json());
    const doc = await firestore(c.env).add(`${userDoc(c.get('uid'))}/transactions`, {
      ...tx,
      createdAt: new Date(),
    });
    return c.json({ id: doc.id, ...tx }, 201);
  })
  .put('/:id', async (c) => {
    const tx = parseTransaction(await c.req.json());
    const id = c.req.param('id');
    await firestore(c.env).update(`${userDoc(c.get('uid'))}/transactions/${id}`, {
      ...tx,
      updatedAt: new Date(),
    });
    return c.json({ id, ...tx });
  })
  .delete('/:id', async (c) => {
    await firestore(c.env).remove(`${userDoc(c.get('uid'))}/transactions/${c.req.param('id')}`);
    return c.body(null, 204);
  });
