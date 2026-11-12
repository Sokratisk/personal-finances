// Runs the sheet mirror for a user (if they linked a sheet) and records the outcome on their profile.
import type { GoogleEnv } from './env.ts';
import type { Profile } from './model.ts';
import { repo } from './repo.ts';
import { sheetsClient } from './sheets.ts';

export type SyncTarget = { years?: number[]; funds?: boolean; all?: boolean };

export async function syncToSheet(env: GoogleEnv, uid: string, target: SyncTarget, profile?: Profile): Promise<Profile['lastSync']> {
  const r = repo(env, uid);
  const p = profile ?? (await r.getProfile());
  if (!p.sheetId) return p.lastSync;

  let lastSync: Profile['lastSync'];
  try {
    const sheets = sheetsClient(env, p.sheetId);
    const years = target.all ? [...p.years].sort((a, b) => b - a) : (target.years ?? []);
    for (const y of years) {
      const data = await r.getYear(y);
      if (data) await sheets.syncYear(data, p.accounts);
    }
    if (target.all || target.funds) await sheets.syncFunds(p.funds);
    lastSync = { at: new Date().toISOString(), ok: true };
  } catch (e) {
    console.error('sheet sync failed', e);
    lastSync = { at: new Date().toISOString(), ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  await r.mutateProfile((prof) => (prof.lastSync = lastSync));
  return lastSync;
}
