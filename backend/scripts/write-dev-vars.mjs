// Writes backend/.dev.vars (local secrets for `wrangler dev`) from backend/service-account.json.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../', import.meta.url);
let json;
try {
  json = JSON.stringify(JSON.parse(readFileSync(new URL('service-account.json', dir), 'utf8')));
} catch {
  console.error('Could not read backend/service-account.json. Download it from Firebase first.');
  process.exit(1);
}
writeFileSync(new URL('.dev.vars', dir), `FIREBASE_SERVICE_ACCOUNT=${json}\n`);
console.log('Wrote backend/.dev.vars');
