# Personal Finances

A yearly budget app modelled on the owner's Google Sheets budget: categories × months, yearly carry-over, monthly account counts, items (trips/purchases) under categories, standalone funds, and an optional one-way mirror to a Google Sheet. Angular frontend + Hono API, both served by **one Cloudflare Worker**. Data lives in **Firebase Firestore**; sign-in is **Firebase Auth (Google)**. Everything is on free tiers (Cloudflare free plan, Firebase Spark).

Live at https://personal-finances.net. **Every push to `main` auto-deploys to production** (Cloudflare Workers Builds). UI language is English; category names are whatever the user types (the owner's are Greek).

## Commands (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Runs the API (`wrangler dev`, :8787) and Angular (`ng serve`, :4200) together. Open :4200. |
| `npm --prefix frontend run build` | Production Angular build → `frontend/dist/frontend/browser` |
| `npm --prefix frontend test -- --watch=false` | Frontend unit tests (Vitest) |
| `npm --prefix backend run typecheck` | Regenerates Worker types (`wrangler types`) and runs `tsc --noEmit` |
| `npm --prefix backend run import -- <xlsx> [--dry-run] [--sheet <id>]` | Imports a yearly budget workbook (**replaces** the user's data). Always `--dry-run` first. |
| `npm run deploy` | Manual deploy. Normally not needed: pushing to `main` deploys. |
| `firebase deploy --only firestore:rules` | Deploys `firestore.rules`. Not part of the auto-deploy. |

Node 24+ is required (Angular 22 doesn't support Node 23; the importer uses Node's built-in TypeScript stripping). Each folder has its own `package.json` and lockfile; no npm workspaces.

## Data model (backend/src/model.ts — mirrored in frontend/src/app/core/models.ts)

```
users/{uid}                          Profile  { years[], accounts[], funds[], sheetId?, lastSync? }
users/{uid}/years/{year}             YearDoc  { opening, categories[], items[], counts{ "1".."12": {balances, stocksValue} } }
users/{uid}/years/{year}/months/{m}  MonthDoc { entries[] }   entry = { id, categoryId, itemId?, amount, note? }
```

- A year loads in ~13 reads (one `batchGet`). Don't add per-entry documents.
- **Entries belong to a month, not a date.** Amounts are stored as typed: positive normally, negative for refunds/splits. The category's `kind` (`income` | `expense` | `stocks`) decides how it counts.
- **Totals (same rules as the sheet)**, in `frontend/src/app/core/ledger.ts`:
  - before stocks = income − expenses;
  - result = before stocks − stocks;
  - year final = Σ result + `opening` (carried over from last year).
- **Categories are per year** and ordered by `order`; expense categories have a `group`.
  - A category with amounts or items is archived (`archived: true`), never deleted.
  - Exactly one category may have `role: 'untraced'`, the target of the monthly-count correction.
- **Items** (trips, purchases) belong to a category; entries can reference them with `itemId`.
- **Monthly count:** suggested untraced = (month result excluding untraced) − (counted total change since the previous month). January uses last year's December count (`prevDecember` in `GET /api/years/:y`). Stocks value is tracked separately and not counted as cash. Saving a count opens a confirmation with the required untraced amount (warning at ≥ €50); the user applies or skips it.
- **Funds** are standalone pots in the profile, outside the monthly cash flow.

## Layout

```
frontend/   Angular 22 app (standalone components, signals, @if/@for)
  src/app/core/           api.service (typed API), finance.store (state), ledger (pure calculations), models, format, auth, PWA
  src/app/year/           year view (route '/'), cell-panel + entry-editor, count-panel, new-year-panel
  src/app/dashboard/      charts      src/app/entries/  all amounts (TanStack Table)
  src/app/trips/          items (trips, purchases…) across all years; open year live from the store, other years via GET /api/items
  src/app/funds/          funds       src/app/categories/  categories, items, accounts, carry-over
  src/app/settings/       Google Sheet link + sync status
  src/app/shared/         summary cards, dialog-position (topOnPhone)
  src/app/demo/           demo mode: sample data, in-memory API, interceptor
  src/app/app.ts          shell: header (single line on lg+, ☰ side menu below), year switcher, privacy toggle, demo banner
  libs/ui/                spartan/ui components (generated, editable)
backend/    Hono app on the Cloudflare Workers runtime (NOT Node)
  src/routes/years.ts     years, categories, items, entries, counts, untraced
  src/routes/profile.ts   profile, settings/sync, accounts, funds
  src/repo.ts             Firestore access with optimistic concurrency (read → modify → write if updateTime unchanged)
  src/firestore.ts        Firestore REST client + Google OAuth tokens (service account)
  src/sheets.ts, sync.ts  Google Sheets mirror (layout builder + Sheets API)
  src/validate.ts         request-body helpers      src/middleware/auth.ts  Firebase ID-token check (jose)
  scripts/import-budget.ts  workbook importer (runs under Node; reuses src/*.ts)
  wrangler.jsonc          Worker config: assets dir, custom domains, vars
scripts/predev.mjs        prep for `npm run dev`
private/                  git-ignored — the owner's real workbook lives here. Never commit or publish it.
```

## UI stack (frontend)

- **Tailwind CSS v4.** Theme lives in `src/styles.css`. Use Tailwind classes and tokens (`bg-background`, `text-muted-foreground`, …); don't add SCSS files.
- **Dark theme is the default.** `class="dark"` on `<html>` in `src/index.html` turns it on. Other dark-matched settings:
  - charts use ECharts' `'dark'` theme with transparent backgrounds;
  - toasts use `theme="dark"`;
  - the manifest and theme colour are `#09090b`.
- **spartan/ui** components are generated into `libs/ui/` and imported as `@spartan-ng/helm/<name>`. Add more with `npx ng g @spartan-ng/cli:ui <name>`. Icons: `@ng-icons/lucide` + `provideIcons`. Toasts: `toast` from `@spartan-ng/brain/sonner`.
  - Don't put a `[class]` binding on an element that has an `hlm*` directive; wrap the content in a `<span>`.
  - Dialogs are controlled with `<hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">` plus `*hlmDialogPortal`.
- **TanStack Table v9**: register features with `tableFeatures({...})` outside the component, then `injectTable(() => ({...}))`. See `entries/entries.ts`. Usage guides ship in `node_modules/@tanstack/angular-table/skills/`; v9 differs from v8.
- **ECharts** via `ngx-echarts`, tree-shaken and lazy-loaded from `src/app/echarts.ts`. Register new chart types there.
- **State:** pages read `FinanceStore` signals. Mutations call `ApiService`, then apply the returned doc with `store.applyYear` / `applyMonths` / `applyProfile`. Never refetch the whole year after a change.
- **The app is zoneless: form fields must be signals.** Writing a plain field (e.g. inside an `effect()`) does not re-render. Seed form fields from store data with `effect(() => this.field.set(...))` and bind `[(ngModel)]="field"` to the signal. This caused the month not being preselected and the carry-over showing 0.
- **`hlm-native-select` works with string values only.** Use `[value]="'' + x"` on options (not `[ngValue]`, which it ignores) and convert back with `(ngModelChange)="x.set(+$event)"`.
- **Privacy mode** (eye button, `core/privacy.service.ts`) adds `.privacy` to `<html>`; `styles.css` blurs `.tabular-nums`, `td.num`, `[echarts]`, `.sensitive` and unfocused number inputs. **Every new amount shown in the UI must carry `tabular-nums` or `sensitive`** or it will leak in privacy mode.
- **Layout & responsive:**
  - Header and `<main>` use `mx-auto w-full max-w-[1920px] px-4 lg:px-8`: full width, capped for ultra-wide screens. Don't reintroduce a narrow centred column.
  - `lg:` and up: one-line header with the tabs. Below `lg`: compact header with a ☰ button opening a right-hand side menu (closes on navigation, backdrop click and Esc). Nav links are defined once in `App.links`.
  - The year view is a grid at `lg:` and up and a month-by-month card list below. Both use the same `sections` (group header rows with per-month totals, collapsible). Collapsed groups are remembered in `localStorage` (`pf-collapsed-groups`).
- **Dialogs with text inputs** bind `[positionStrategy]="topOnPhone(injector, openSignal)()"` (`shared/dialog-position.ts`) so they sit at the top on phones, above the keyboard. A strategy can't be reused after its dialog closes; the helper makes a fresh one on each open.
- **Add form** (`year/entry-editor.ts`):
  - Field order: month → amount → category → item → note. Month comes first so the phone keyboard doesn't open on load.
  - The add dialog always starts on the current month. On phones it auto-opens once per launch, for the current year only.
  - The amount field is a text input sanitised to digits, one decimal point (comma → point), 2 decimals and an optional leading minus.
  - An ongoing trip (an item whose month matches) is preselected.
- **Dashboard:** Balance has a Lines/Stacked toggle (stacked = each account + stocks value per month). Top expense categories shows the top 12, with "Show all"; the chart height grows with the number of rows.

## Architecture rules

- **Request flow:** same-origin `/api/*`, so no CORS. `run_worker_first: ["/api/*"]` sends only the API to Hono; everything else is static, with SPA fallback.
- **The backend runs on Workers, not Node.** No `firebase-admin`, `express`, `fs`, `net` or gRPC. Use `fetch`/Web APIs and `jose`.
- **Backend imports use explicit `.ts` extensions** (`allowImportingTsExtensions`), so the Node importer can reuse `src/*.ts`.
- **Firestore access goes through `repo.ts` / `firestore.ts`.** Nested maps and arrays are supported. Numbers are stored as `doubleValue`.
- **The browser never talks to Firestore directly.** Rules deny everything; the Worker uses the service account.
- **Auth:** protected routes use `requireAuth` and then `c.get('uid')`. Never trust a uid from the request.
- **Validate inputs with `validate.ts` helpers.** Throw `HTTPException`; `onError` returns `{ error }`.
- **Sheet mirror:**
  - After each mutation, routes call `c.executionCtx.waitUntil(syncToSheet(...))` for the affected year (or funds), so it never delays the response.
  - The mirror rewrites whole tabs and sets the spreadsheet locale to `en_GB` so dot-decimal formulas parse.
  - The result is recorded in `profile.lastSync`.
  - It needs the Google Sheets API enabled and the sheet shared (Editor) with the service account.
- **Demo mode** (`src/app/demo/`): "Try the demo" / `?demo` sets `AuthService.demo` with a fake user. `demoInterceptor` (registered before `authInterceptor`) answers every `/api` call from `DemoBackend`, an in-memory copy of the API over `createDemoState()` sample data, so nothing reaches the server. **When you add or change an API route, mirror it in `demo-backend.ts`** (tests: `demo-backend.spec.ts`). Sheet sync is refused in the demo.
- **PWA:**
  - The service worker runs in production builds only; `/api/**` is never cached.
  - The install button lives in `install-button/` + `core/pwa-install.service.ts`.
  - After a deploy, installed apps show an Update button.
- **Free-tier limits:** Worker CPU is 10 ms per request; Firestore allows 50k reads and 20k writes a day.

## Secrets and config

- `backend/service-account.json`, `backend/.dev.vars` and `private/` are **secret and git-ignored**. Never commit, print or log them.
- In production, the service account is the Cloudflare secret `FIREBASE_SERVICE_ACCOUNT` (`npm --prefix backend run secret:push`).
- Firebase project: `personal-finances-1cbca`, `(default)` database. The Firebase web config in `environment*.ts` is public by design.
- **Local dev uses the production Firestore database and the owner's real sheet mirror.** Test with temporary data and clean it up. README screenshots must use sample data, never real data.
- **README screenshots** (`docs/screenshots/`: year, dashboard, mobile, trips) are taken from the demo: serve the production build, open `/?demo` in headless Chrome, remove the "Demo mode" banner, then capture desktop (~1440px wide) and phone (~520px wide) shots.
