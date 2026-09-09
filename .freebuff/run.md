# Run doc — Rental Management System (preview on port 4000)

## 1. Reproduce the artifacts a fresh checkout needs

1. **Install dependencies** (server only — the client has no build step):
   ```
   cd server
   npm install
   ```
2. **Copy `server/.env` from the main checkout** (never commit it; values are
   machine-specific — adapt `DATABASE_URL`/`CORS_ORIGIN` if the port changes).
   Fresh alternative: `cp server/.env.example server/.env` and set a real
   `JWT_SECRET` + `DATABASE_URL`.
3. **Provision Postgres 15+ on localhost:5432** (one-time, from the README):
   ```
   psql -U postgres -h localhost -c "CREATE ROLE rms_user LOGIN PASSWORD 'rms_password' CREATEDB;"
   psql -U postgres -h localhost -c "CREATE DATABASE rental_management OWNER rms_user;"
   ```
4. **Migrate + seed** (both idempotent):
   ```
   npm run migrate
   npm run seed
   ```
   Login: `admin@olbano.example` / `ChangeMe123!` (verified working 2026-09-06;
   the password had been changed via the user-management UI after seeding and
   was reset to the documented value — bcrypt hash + `password_version` bump,
   same as the app's own reset path, so any stale sessions were invalidated).

## 2. Run the server

One process serves **both** the API and the static client (`src/app.js`
mounts `client/` at `/`), so no separate static server is needed:

```
cd server
npm run dev
```

- URL: **http://localhost:4000** (health: `GET /api/health`)
- Port comes from `server/.env` (`PORT`, default 4000); change it there if
  busy. `CORS_ORIGIN=http://localhost:5173` is irrelevant for this
  single-origin setup (cookies are same-site trivially).
- Detached start (Windows, run from `server/`):
  ```
  powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
  ```
  stdout and stderr must go to DIFFERENT files. Note: `npm run dev` uses
  nodemon — the listening `node.exe` pid differs from the npm pid printed.
