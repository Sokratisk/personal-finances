import { HTTPException } from 'hono/http-exception';

export const bad = (message: string) => new HTTPException(400, { message });
export const notFound = (what: string) => new HTTPException(404, { message: `${what} not found` });

type Body = Record<string, unknown>;

export async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Body> {
  try {
    const b = await c.req.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b as Body;
  } catch {
    /* fall through */
  }
  throw bad('JSON object body required');
}

export function str(b: Body, key: string, opts: { max?: number; optional?: boolean } = {}): string | undefined {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return undefined;
    throw bad(`${key} is required`);
  }
  if (typeof v !== 'string') throw bad(`${key} must be text`);
  const s = v.trim();
  if (!s && !opts.optional) throw bad(`${key} is required`);
  if (s.length > (opts.max ?? 100)) throw bad(`${key} is too long`);
  return s || undefined;
}

export function num(b: Body, key: string, opts: { optional?: boolean } = {}): number | undefined {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return undefined;
    throw bad(`${key} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9) throw bad(`${key} must be a number`);
  return Math.round(v * 100) / 100;
}

export function oneOf<T extends string>(b: Body, key: string, values: readonly T[], opts: { optional?: boolean } = {}): T | undefined {
  const v = b[key];
  if (v === undefined && opts.optional) return undefined;
  if (!values.includes(v as T)) throw bad(`${key} must be one of ${values.join(', ')}`);
  return v as T;
}

export function bool(b: Body, key: string): boolean | undefined {
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw bad(`${key} must be true/false`);
  return v;
}

export function yearParam(s: string): number {
  const y = Number(s);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw bad('invalid year');
  return y;
}

export function monthParam(s: unknown): number {
  const m = Number(s);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw bad('month must be 1-12');
  return m;
}
