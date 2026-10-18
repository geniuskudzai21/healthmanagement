# HealthFlow — Hosting Guide

Frontend on **Vercel**, backend on **Render**, database on **Neon**.

## 0. Prerequisites

- The repo pushed to GitHub
- A free [Neon](https://neon.tech) database
- Accounts on [Render](https://render.com) and [Vercel](https://vercel.com)

## 1. Database (Neon)

1. Create a Neon project and copy its **connection string**.
2. Add `?sslmode=require` to the end.

## 2. Backend (Render)

1. Render → **New → Blueprint** → pick the repo (uses `render.yaml`).
2. When prompted, set:
   - `DATABASE_URL` — the Neon string from step 1
   - `ADMIN_PASSWORD` — a strong password
   - `CORS_ORIGIN` — your Vercel URL (add it after step 3; you can set a placeholder now)
3. Deploy. Build runs `migrate + seed` automatically, health check is `/api/health`.

> Using a **manual Web Service** instead of the Blueprint? Add every variable from
> the table below yourself, otherwise the server crashes on boot.

### Required environment variables

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Neon string + `?sslmode=require` |
| `JWT_SECRET` | a long random string (Render can generate it) |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAME_SITE` | `none` *(UI and API are on different domains)* |
| `CORS_ORIGIN` | your Vercel URL, e.g. `https://healthflow-ui.vercel.app` |
| `ADMIN_EMAIL` | `admin@healthflow.local` |
| `ADMIN_PASSWORD` | a strong password |

Missing `JWT_SECRET` is the #1 cause of `Error: JWT_SECRET must be set in production.`
4. Note your API URL, e.g. `https://healthflow-api.onrender.com`.

## 3. Frontend (Vercel)

1. Edit `frontend/index.html` and set the API URL:

   ```html
   window.HEALTHFLOW_API = 'https://healthflow-api.onrender.com';
   ```

2. Vercel → **Add New → Project** → import the repo.
3. Set **Root Directory** to `frontend`, **Framework Preset** = *Other* (static, no build).
4. Deploy. Note your URL, e.g. `https://healthflow-ui.vercel.app`.

## 4. Connect them

1. Back in Render, set `CORS_ORIGIN` to the Vercel URL (comma-separate multiple).
2. Redeploy the backend.

Sign in with `admin@healthflow.local` / your `ADMIN_PASSWORD` and change it right away.

## Tip

Instead of editing `index.html`, set the API at runtime from the browser console:

```js
localStorage.hf_api_base = 'https://healthflow-api.onrender.com';
```

## 5. Keep the free API awake (cron)

Render's **free** web services spin down after ~15 minutes with no traffic, so the
next request pays a 30–60s cold start. A scheduled ping keeps it warm.

**Option A — GitHub Actions (already in the repo).**
`.github/workflows/keepalive.yml` curls `https://healthmanagement-i1yn.onrender.com/api/health`
every 10 minutes. It runs automatically once the repo is on GitHub; trigger it
manually from **Actions → Keep API awake → Run workflow** the first time.

**Option B — external monitor (most reliable).**
Create a free monitor at [cron-job.org](https://cron-job.org) or
[UptimeRobot](https://uptimerobot.com) that GETs the same health URL every
5–10 minutes.

**Option C — Render Cron Job (dashboard).**
Render → **New → Cron Job**, schedule `*/10 * * * *`, command
`curl -s https://healthmanagement-i1yn.onrender.com/api/health`. (Note: Render
cron jobs require a paid instance type.)

> The health endpoint is `/api/health` and needs no authentication.

## 6. Managing user accounts

Admins have a **Users** page (sidebar → *Users*, route `#/users`) to:

- **Create** staff accounts (role, name, email, phone, password).
- **Edit** any account (role/name/email/phone, optional password reset).
- **Deactivate / Activate** accounts — a deactivated account cannot sign in and
  is rejected on its next request.
- **Delete** accounts. Accounts with linked clinical/billing records are
  protected: you are prompted to deactivate instead. You cannot delete or
  deactivate your own account, and the last active admin is always preserved.

