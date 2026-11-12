// Prints backend/service-account.json as a single line (used to set the Cloudflare secret).
import { readFileSync } from 'node:fs';

const file = new URL('../service-account.json', import.meta.url);
try {
  process.stdout.write(JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))));
} catch {
  console.error('Could not read backend/service-account.json. Download it from Firebase first.');
  process.exit(1);
}
