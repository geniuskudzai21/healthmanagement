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
