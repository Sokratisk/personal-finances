// Minimal Firestore REST client for Cloudflare Workers (firebase-admin needs Node, so we use fetch).
import { HTTPException } from 'hono/http-exception';
import { importPKCS8, SignJWT } from 'jose';
import type { Bindings } from './env';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

type Value =
  | { stringValue: string }
  | { doubleValue: number }
  | { integerValue: string }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null };

export type Fields = Record<string, string | number | boolean | Date | null>;

// ---- Google OAuth access token (cached per Worker isolate for ~1 hour) ----
let cached: { token: string; expires: number } | null = null;

async function accessToken(env: Bindings): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is not set');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

// ---- value encoding ----
function encode(fields: Fields): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) out[k] = { nullValue: null };
    else if (v instanceof Date) out[k] = { timestampValue: v.toISOString() };
    else if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else out[k] = { doubleValue: v };
  }
  return out;
}

function decode(fields: Record<string, Value> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else out[k] = null;
  }
  return out;
}

interface RestDoc {
  name: string;
  fields?: Record<string, Value>;
}

export interface Doc {
  id: string;
  data: Record<string, unknown>;
}

const toDoc = (d: RestDoc): Doc => ({ id: d.name.split('/').pop()!, data: decode(d.fields) });

// ---- client ----
export function firestore(env: Bindings) {
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/${env.FIRESTORE_DATABASE}/documents`;
  const base = `https://firestore.googleapis.com/v1/${root}`;
  const seg = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404) throw new HTTPException(404, { message: 'Not found' });
    if (!res.ok) throw new Error(`Firestore ${method} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  return {
    /** Query a sub-collection, e.g. parent "users/abc", collection "transactions". */
    async list(parent: string, collection: string, opts: { orderBy?: string; desc?: boolean; limit?: number } = {}) {
      const rows = await call<{ document?: RestDoc }[]>('POST', `${base}/${seg(parent)}:runQuery`, {
        structuredQuery: {
          from: [{ collectionId: collection }],
          ...(opts.orderBy && {
            orderBy: [{ field: { fieldPath: opts.orderBy }, direction: opts.desc ? 'DESCENDING' : 'ASCENDING' }],
          }),
          ...(opts.limit && { limit: opts.limit }),
        },
      });
      return rows.filter((r) => r.document).map((r) => toDoc(r.document!));
    },

    /** Add a document with an auto-generated id. */
    async add(collectionPath: string, fields: Fields) {
      return toDoc(await call<RestDoc>('POST', `${base}/${seg(collectionPath)}`, { fields: encode(fields) }));
    },

    /** Merge fields into an existing document; 404 if it does not exist. */
    async update(docPath: string, fields: Fields) {
      const qs = new URLSearchParams({ 'currentDocument.exists': 'true' });
      for (const k of Object.keys(fields)) qs.append('updateMask.fieldPaths', k);
      return toDoc(await call<RestDoc>('PATCH', `${base}/${seg(docPath)}?${qs}`, { fields: encode(fields) }));
    },

    async remove(docPath: string) {
      await call('DELETE', `${base}/${seg(docPath)}`);
    },
  };
}
