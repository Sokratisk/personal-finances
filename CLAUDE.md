# Personal Finances

Personal finance tracker. Angular frontend + Hono API, both served by **one Cloudflare Worker**. Data lives in **Firebase Firestore**; sign-in is **Firebase Auth (Google)**. Everything is on free tiers: Cloudflare free plan and Firebase Spark.

Live at https://personal-finances.net. **Every push to `main` auto-deploys to production** (Cloudflare Workers Builds).

## Commands (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Runs the API (`wrangler dev`, :8787) and Angular (`ng serve`, :4200) together. Open :4200. |
| `npm --prefix frontend run build` | Production Angular build → `frontend/dist/frontend/browser` |
| `npm --prefix frontend test -- --watch=false` | Frontend unit tests (Vitest) |
| `npm --prefix backend run typecheck` | Regenerates Worker types (`wrangler types`) and runs `tsc --noEmit` |
| `npm run deploy` | Manual deploy (builds Angular + `wrangler deploy`). Normally not needed: pushing to `main` deploys. |
| `firebase deploy --only firestore:rules` | Deploys `firestore.rules`. Not part of the auto-deploy. |

Node 24+ is required: Angular 22 doesn't support Node 23. Each folder has its own `package.json` and lockfile; there are no npm workspaces.

## Layout

```
frontend/   Angular 22 app (standalone components, signals, new control flow @if/@for)
  src/app/core/           auth.service (Firebase Auth), auth.interceptor (adds Bearer token), API services
  src/app/transactions/   transactions page (lazy route)
  src/environments/       environment.ts (prod) / environment.development.ts — Firebase web config (public)
  proxy.conf.json         ng serve proxies /api → http://localhost:8787
backend/    Hono app running on the Cloudflare Workers runtime (NOT Node)
  src/index.ts            app entry, basePath /api, error handling
  src/routes/             route modules (transactions.ts)
  src/middleware/auth.ts  verifies Firebase ID tokens with `jose`
  src/firestore.ts        small Firestore REST client (list/add/update/remove)
  src/env.ts              Bindings / AppEnv types
  wrangler.jsonc          Worker config: assets dir, custom domains, vars
scripts/predev.mjs        prep for `npm run dev` (installs deps, creates .dev.vars)
firestore.rules           denies all direct client access
```

## Architecture rules

- **Request flow:** the browser calls `/api/*` on the same origin, so there is no CORS. In `wrangler.jsonc`, `run_worker_first: ["/api/*"]` sends only API calls to Hono. All other paths are static Angular files, with SPA fallback to `index.html`.
- **The backend runs on Workers, not Node.** Don't add Node-only packages: `firebase-admin`, `express`, anything that needs `fs`, `net` or gRPC. Use `fetch`/Web APIs. Use `jose` for JWTs.
- **Firestore access goes through `backend/src/firestore.ts`** (REST + a service-account OAuth token cached per isolate). Extend that client instead of adding an SDK. Numbers are stored as `doubleValue`; dates are ISO strings.
- **The browser never talks to Firestore directly.** Rules deny everything; the Worker uses the service account, which bypasses rules. Don't add the Firestore web SDK to the frontend.
- **Auth:** every protected route uses the `requireAuth` middleware, then reads `c.get('uid')`. User data is always scoped under `users/{uid}/...`. Never trust a uid from the request body or params.
- **Validate request bodies in the route** (see `parseTransaction`). Throw `HTTPException(400|404, { message })`. `onError` turns it into `{ error }` JSON.
- **Frontend API calls** use `${environment.apiUrl}/api/...`. `apiUrl` is `''` in both environments. The interceptor adds the token only to `/api/` URLs.
- **PWA (installable app):**
  - `@angular/service-worker`, configured in `ngsw-config.json`, runs in production builds only, not in `ng serve`. `/api/**` is excluded from navigation handling, and API responses are never cached.
  - Manifest: `public/manifest.webmanifest`. Icons are in `public/icons/`, generated from `icon.svg`.
  - The install button is `install-button/` + `core/pwa-install.service.ts`: the native prompt on Chrome/Edge/Android, Share → Add to Home Screen instructions on iOS.
  - After a deploy, installed apps show a "New version · Reload" button (`SwUpdate` in `app.ts`).
- **Free-tier limits:** Worker CPU is 10 ms per request, and Firestore allows 50k reads and 20k writes a day. Avoid unbounded queries (always `limit`) and per-request heavy crypto.

## Adding things

- **New API resource:** create `backend/src/routes/<name>.ts` as `new Hono<AppEnv>().use(requireAuth)...` and mount it in `src/index.ts` with `app.route('/<name>', ...)`.
- **New page:** create a standalone component under `frontend/src/app/<feature>/` and add a lazy `loadComponent` route in `app.routes.ts`. Add the API service in `core/`.
- **New Worker var or binding:** add it to `wrangler.jsonc` and `src/env.ts`, then run `npm --prefix backend run typecheck` to regenerate `worker-configuration.d.ts`.

## Secrets and config

- `backend/service-account.json` and `backend/.dev.vars` are **secret and git-ignored**. Never commit, print or log them.
- In production, the service account is the Cloudflare secret `FIREBASE_SERVICE_ACCOUNT`, set with `npm --prefix backend run secret:push`.
- Firebase web config in `environment*.ts` is public and is committed on purpose.
- Firebase project: `personal-finances-1cbca`, `(default)` Firestore database.
- **Local dev uses the production Firestore database.** Be careful with test data and destructive operations.
