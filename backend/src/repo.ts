// Data access for one user, with optimistic concurrency (read → modify → write if unchanged).
import type { GoogleEnv } from './env.ts';
import { ConflictError, firestore } from './firestore.ts';
import {
  type Entry,
  type MonthDoc,
  type Profile,
  type YearDoc,
  MONTHS,
  emptyProfile,
  emptyYear,
} from './model.ts';

export interface YearData {
  year: YearDoc;
  months: Record<number, Entry[]>;
}

export function repo(env: GoogleEnv, uid: string) {
  const fs = firestore(env);
  const profilePath = `users/${uid}`;
  const yearPath = (y: number) => `users/${uid}/years/${y}`;
  const monthPath = (y: number, m: number) => `users/${uid}/years/${y}/months/${m}`;

  /** Read-modify-write with retry. `fn` may mutate the doc in place; return value is passed through. */
  async function mutate<T extends object, R>(path: string, init: () => T, fn: (doc: T) => R): Promise<{ doc: T; result: R }> {
    for (let attempt = 0; ; attempt++) {
      const snap = await fs.get<T>(path);
      const doc = snap ? snap.data : init();
      const result = fn(doc);
      try {
        await fs.set(path, doc, snap ? { updateTime: snap.updateTime } : { exists: false });
        return { doc, result };
      } catch (e) {
        if (e instanceof ConflictError && attempt < 3) continue;
        throw e;
      }
    }
  }

  const normProfile = (p: Partial<Profile> | undefined): Profile => ({ ...emptyProfile(), ...p });
  const normYear = (y: number, d: Partial<YearDoc> | undefined): YearDoc => ({ ...emptyYear(y), ...d, counts: d?.counts ?? {} });

  return {
    async getProfile(): Promise<Profile> {
      return normProfile((await fs.get<Profile>(profilePath))?.data);
    },

    async mutateProfile<R>(fn: (p: Profile) => R) {
      const { doc, result } = await mutate<Profile, R>(profilePath, emptyProfile, (p) => fn(Object.assign(p, normProfile(p))));
      return { profile: doc, result };
    },

    async getYearDoc(y: number): Promise<YearDoc | null> {
      const snap = await fs.get<YearDoc>(yearPath(y));
      return snap ? normYear(y, snap.data) : null;
    },

    /** Year doc + all 12 months in one batched request. */
    async getYear(y: number): Promise<YearData | null> {
      const snaps = await fs.getAll<YearDoc | MonthDoc>([yearPath(y), ...MONTHS.map((m) => monthPath(y, m))]);
      if (!snaps[0]) return null;
      const months: Record<number, Entry[]> = {};
      MONTHS.forEach((m, i) => (months[m] = ((snaps[i + 1]?.data as MonthDoc | undefined)?.entries ?? [])));
      return { year: normYear(y, snaps[0].data as YearDoc), months };
    },

    async mutateYear<R>(y: number, fn: (doc: YearDoc) => R) {
      const { doc, result } = await mutate<YearDoc, R>(yearPath(y), () => emptyYear(y), (d) => fn(Object.assign(d, normYear(y, d))));
      return { year: doc, result };
    },

    async mutateMonth<R>(y: number, m: number, fn: (entries: Entry[]) => R) {
      const { doc, result } = await mutate<MonthDoc, R>(monthPath(y, m), () => ({ entries: [] }), (d) => {
        d.entries ??= [];
        return fn(d.entries);
      });
      return { entries: doc.entries, result };
    },

    /** Overwrite a whole year (used by the importer). */
    async putYear(data: YearData) {
      const y = data.year.year;
      await fs.set(yearPath(y), data.year);
      for (const m of MONTHS) {
        const entries = data.months[m] ?? [];
        if (entries.length) await fs.set(monthPath(y, m), { entries });
        else await fs.remove(monthPath(y, m));
      }
    },

    async putProfile(p: Profile) {
      await fs.set(profilePath, p);
    },

    /** Delete legacy data from the first version of the app (users/{uid}/transactions). */
    async deleteLegacyTransactions(): Promise<number> {
      const ids = await fs.listIds(`users/${uid}/transactions`);
      for (const id of ids) await fs.remove(`users/${uid}/transactions/${id}`);
      return ids.length;
    },
  };
}

export type Repo = ReturnType<typeof repo>;
