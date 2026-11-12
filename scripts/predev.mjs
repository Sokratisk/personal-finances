// Runs before `npm run dev`: makes sure everything the local servers need is in place.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const has = (p) => existsSync(new URL(p, root));
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

// 1. Dependencies
for (const dir of ['backend', 'frontend']) {
  if (!has(`${dir}/node_modules`)) {
    console.log(`Installing ${dir} dependencies...`);
    run(`npm --prefix ${dir} install`);
  }
}

// 2. Local secrets for wrangler dev
if (!has('backend/.dev.vars')) {
  if (!has('backend/service-account.json')) {
    console.error(
      '\nMissing backend/service-account.json.\n' +
        'Download it from Firebase -> Project settings -> Service accounts -> Generate new private key.\n',
    );
    process.exit(1);
  }
  run('node backend/scripts/write-dev-vars.mjs');
}

// 3. wrangler needs the assets folder to exist (the app itself is served by ng serve on :4200)
const dist = new URL('frontend/dist/frontend/browser/', root);
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
