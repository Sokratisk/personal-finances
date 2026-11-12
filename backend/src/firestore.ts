// Minimal Firestore REST client for Cloudflare Workers (firebase-admin needs Node, so we use fetch).
// Also runs under Node (import script) thanks to plain fetch + Web Crypto.
import { importPKCS8, SignJWT } from 'jose';
import type { GoogleEnv } from './env.ts';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export const SCOPES = {
  datastore: 'https://www.googleapis.com/auth/datastore',
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  identity: 'https://www.googleapis.com/auth/identitytoolkit',
};

export class ConflictError extends Error {}

// ---- Google OAuth access tokens (cached per isolate for ~1 hour, per scope set) ----
const tokenCache = new Map<string, { token: string; expires: number }>();

export function serviceAccountEmail(env: GoogleEnv): string | null {
  try {
    return (JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount).client_email;
  } catch {
    return null;
  }
}

export async function googleToken(env: GoogleEnv, scopes: string[]): Promise<string> {
  const scope = scopes.join(' ');
  const hit = tokenCache.get(scope);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;

  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is not set');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope })
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
  tokenCache.set(scope, { token: data.access_token, expires: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

// ---- value encoding (supports nested maps/arrays) ----
type Value =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: Value[] } }
  | { mapValue: { fields?: Record<string, Value> } };

function toValue(v: unknown): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
}

function toFields(obj: Record<string, unknown>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toValue(v);
  return out;
}

function fromValue(v: Value): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  return fromFields(v.mapValue.fields ?? {});
}

function fromFields(fields: Record<string, Value>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}

interface RestDoc {
  name: string;
  fields?: Record<string, Value>;
  updateTime: string;
}

export interface Snapshot<T> {
  data: T;
  updateTime: string;
}

// ---- client ----
export function firestore(env: GoogleEnv) {
  const dbPath = `projects/${env.FIREBASE_PROJECT_ID}/databases/${env.FIRESTORE_DATABASE}`;
  const root = `${dbPath}/documents`;
  const base = `https://firestore.googleapis.com/v1/${root}`;
  const seg = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  async function call(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await googleToken(env, [SCOPES.datastore]);
    return fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function fail(res: Response, what: string): Promise<never> {
    const text = await res.text();
    if (res.status === 409 || text.includes('FAILED_PRECONDITION')) throw new ConflictError(text);
    throw new Error(`Firestore ${what} failed: ${res.status} ${text}`);
  }

  return {
    /** Read one document, or null if it doesn't exist. */
    async get<T>(path: string): Promise<Snapshot<T> | null> {
      const res = await call('GET', `${base}/${seg(path)}`);
      if (res.status === 404) return null;
      if (!res.ok) return fail(res, `GET ${path}`);
      const doc = (await res.json()) as RestDoc;
      return { data: fromFields(doc.fields ?? {}) as T, updateTime: doc.updateTime };
    },

    /** Read several documents in one request (missing ones are null). */
    async getAll<T>(paths: string[]): Promise<(Snapshot<T> | null)[]> {
      if (!paths.length) return [];
      const res = await call('POST', `${base}:batchGet`, { documents: paths.map((p) => `${root}/${p}`) });
      if (!res.ok) return fail(res, 'batchGet');
      const rows = (await res.json()) as { found?: RestDoc; missing?: string }[];
      const byName = new Map<string, Snapshot<T>>();
      for (const r of rows) {
        if (r.found) byName.set(r.found.name, { data: fromFields(r.found.fields ?? {}) as T, updateTime: r.found.updateTime });
      }
      return paths.map((p) => byName.get(`${root}/${p}`) ?? null);
    },

    /**
     * Replace a whole document. `precondition`: `updateTime` (must be unchanged since read)
     * or `exists: false` (must not exist yet). Throws ConflictError if the precondition fails.
     */
    async set(path: string, data: object, precondition?: { updateTime?: string; exists?: boolean }) {
      const qs = new URLSearchParams();
      if (precondition?.updateTime) qs.set('currentDocument.updateTime', precondition.updateTime);
      else if (precondition?.exists !== undefined) qs.set('currentDocument.exists', String(precondition.exists));
      const res = await call('PATCH', `${base}/${seg(path)}${qs.size ? `?${qs}` : ''}`, {
        fields: toFields(data as Record<string, unknown>),
      });
      if (!res.ok) return fail(res, `PATCH ${path}`);
    },

    async remove(path: string) {
      const res = await call('DELETE', `${base}/${seg(path)}`);
      if (!res.ok && res.status !== 404) return fail(res, `DELETE ${path}`);
    },

    /** Document paths in a collection (used by maintenance scripts). */
    async listIds(collectionPath: string): Promise<string[]> {
      const ids: string[] = [];
      let pageToken = '';
      do {
        const qs = new URLSearchParams({ pageSize: '300', 'mask.fieldPaths': '__name__' });
        if (pageToken) qs.set('pageToken', pageToken);
        const res = await call('GET', `${base}/${seg(collectionPath)}?${qs}`);
        if (res.status === 404) break;
        if (!res.ok) return fail(res, `LIST ${collectionPath}`);
        const data = (await res.json()) as { documents?: { name: string }[]; nextPageToken?: string };
        for (const d of data.documents ?? []) ids.push(d.name.split('/').pop()!);
        pageToken = data.nextPageToken ?? '';
      } while (pageToken);
      return ids;
    },
  };
}

export type Firestore = ReturnType<typeof firestore>;
