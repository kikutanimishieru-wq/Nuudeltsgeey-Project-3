# Production deployment: Vercel + Neon

This project is prepared for a Next.js deployment on Vercel using the existing PostgreSQL database hosted by Neon.

## Before deployment

1. Create a production Neon database or production branch. Do not use the local demo database for public traffic.
2. Create a fresh production `AUTH_SECRET`.
3. Confirm the production admin account and remove demo passwords.
4. Run the pre-deployment checks from `backend/`:

```sh
npm run predeploy
```

5. Apply committed migrations to the production database from a trusted environment:

```sh
npx prisma migrate deploy
npx prisma generate
```

Do not use `prisma migrate dev` against production.

## Vercel environment variables

Add these variables in Vercel for Preview and Production as appropriate:

```text
DATABASE_URL=<Neon pooled connection string>
AUTH_SECRET=<long random production secret>
AUTH_TRUST_HOST=true
```

Keep the direct Neon connection string available for migration jobs if your Neon plan provides separate pooled and direct URLs. The application runtime should use the pooled URL when recommended by Neon.

## Vercel project settings

- Framework preset: Next.js
- Root directory: `backend`
- Build command: `npm run build`
- Install command: `npm ci`
- Output directory: leave blank/default
- Node.js version: use the project-supported Vercel default unless the team pins one explicitly

Vercel should run the Next.js build automatically. Do not add a custom server process.

## Post-deployment smoke test

Set the deployed URL and run:

```sh
DEMO_BASE_URL=https://your-domain.example npm run demo:smoke
```

Check these flows manually:

- Public homepage and banner
- Leaderboard and public player profile
- Tournament details and locked result history
- Admin login
- Admin read-only dashboard metrics
- Check-in, roster lock, bracket generation, and result locking
- `/api/health`

## Production blockers still requiring product approval

The following workflows are intentionally not invented or enabled until their rules are approved:

- Captain result submission and dispute handling
- Result correction and reversal policy
- Duplicate-account merge policy
- Evidence/file upload storage
- Banlist and disciplinary policy UI

The current admin dashboard labels these areas as Planned and keeps the approved admin result-locking workflow available.

## Security handoff

- Never commit `.env` or production secrets.
- Keep private identity fields out of public API selections.
- Rotate demo credentials before inviting investors or players.
- Enable database backups and verify a restore procedure before public launch.
- Add a custom domain and HTTPS before real account registration.
