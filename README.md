# KICKOFF

Football community and game-booking app for Potato FC, South Bengaluru.

- Frontend: React + Vite
- Backend: Supabase (Auth, Postgres, RLS)
- Hosting: Netlify (build `npm run build`, publish `dist`)

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Create a `.env` file with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Database changes are recorded in `supabase/migrations/`.
