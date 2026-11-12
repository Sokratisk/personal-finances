# Personal Finances

Everything runs free: Cloudflare (free plan) + Firebase (Spark plan). No credit card needed.

| Part     | Tech                                        | Where                                        |
| -------- | ------------------------------------------- | -------------------------------------------- |
| Frontend | Angular 22 (`frontend/`)                    | Cloudflare Worker static assets              |
| Backend  | Hono (`backend/`)                           | The same Cloudflare Worker, at `/api/*`      |
| Database | Firestore + Firebase Auth (Google sign-in)  | Firebase Spark (free) plan                   |

```
Browser ──► your-domain.com ──► Cloudflare Worker
                                 ├─ /*      Angular files (free, unmetered)
                                 └─ /api/*  Hono: verifies the Firebase ID token,
                                            then reads/writes Firestore over REST
```

- The frontend and API share one domain, so there's no CORS and no cold starts.
- The browser never touches Firestore directly: `firestore.rules` denies all client access.
  Only the Worker can read or write, using the service-account key stored as a Cloudflare secret.
- Each user's data lives at `users/{uid}/transactions/{id}`.

Free plan limits, far above personal use:
- **Cloudflare:** 100k API requests/day and 10 ms of CPU per request. Static files are unlimited.
- **Firestore:** 1 GiB stored, 50k reads/day, 20k writes/day.

> **Node version:** use **Node 24 LTS or newer**. Angular 22 doesn't support Node 23.

---

## 1. Firebase setup (one time)

1. https://console.firebase.google.com → **Create a project**. You stay on the free **Spark** plan.
2. *Build → Firestore Database → Create database* → **Production mode**, pick a location. The location is permanent.
3. *Build → Authentication → Get started → Sign-in method → Google → Enable*.
   Set the public-facing name and support email, then **Save**.
4. *Project settings → General → Your apps → `</>` (Web)* → register an app (no Hosting).
   Copy `apiKey`, `authDomain`, `projectId` and `appId` into `frontend/src/environments/environment*.ts`.
   These values are public and safe to commit.
5. *Project settings → Service accounts → Generate new private key* → save it as `backend/service-account.json`.
   **This file is secret.** It's git-ignored.
6. If your project ID differs, update `FIREBASE_PROJECT_ID` in `backend/wrangler.jsonc`.
7. Deploy the lock-down rules:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add            # pick the project, alias: default
   firebase deploy --only firestore:rules
   ```

## 2. Run locally

```bash
npm run install:all
npm --prefix backend run setup:dev-vars   # writes backend/.dev.vars from service-account.json
npm --prefix frontend run build           # wrangler dev serves this build too
```

In two terminals:

```bash
npm run dev:backend    # wrangler dev → http://localhost:8787  (try /api/health)
npm run dev:frontend   # ng serve     → http://localhost:4200  (live reload; proxies /api to :8787)
```

Open http://localhost:4200 and sign in with Google.
Local development uses the **same Firestore database** as production.

## 3. Deploy to Cloudflare

One time:

```bash
cd backend
npx wrangler login               # opens browser
npm run secret:push              # uploads service-account.json as the FIREBASE_SERVICE_ACCOUNT secret
```

Every deploy, from the repo root:

```bash
npm run deploy                   # builds Angular, then deploys the Worker
```

You get `https://personal-finances.<your-subdomain>.workers.dev`.

Then in **Firebase → Authentication → Settings → Authorized domains**, add the `workers.dev` hostname and your custom domain.
Without this, Google sign-in fails there.

### Custom domain (bought on Cloudflare)

`personal-finances.net` and `www.personal-finances.net` are set in `routes` in `backend/wrangler.jsonc`.
`npm run deploy` attaches them and creates the DNS records and SSL certificate automatically.
The domain must be active in the same Cloudflare account, with no existing DNS records for those hostnames.

### Auto-deploy on git push (optional)

*Workers & Pages → personal-finances → Settings → Build → Connect* → GitHub → `Sokratisk/personal-finances`:

| Setting                 | Value                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Branch                  | `main`                                                                             |
| Root directory          | `backend`                                                                          |
| Build command           | `npm ci && npm --prefix ../frontend ci && npm --prefix ../frontend run build`      |
| Deploy command          | `npx wrangler deploy`                                                              |
| Build variable          | `NODE_VERSION` = `24`                                                              |
| Non-production branches | off (previews would use the production database)                                   |

The `FIREBASE_SERVICE_ACCOUNT` secret stays in place across builds.

## API

All `/api/transactions` routes need `Authorization: Bearer <Firebase ID token>`. The frontend adds this automatically.

| Method | Path                    | Body                                      |
| ------ | ----------------------- | ----------------------------------------- |
| GET    | `/api/health`           | (public)                                  |
| GET    | `/api/transactions`     | (none)                                    |
| POST   | `/api/transactions`     | `{ description, amount, category, date }` |
| PUT    | `/api/transactions/:id` | same as POST                              |
| DELETE | `/api/transactions/:id` | (none)                                    |

`amount` is positive for income and negative for expenses. `date` is `yyyy-mm-dd`.
