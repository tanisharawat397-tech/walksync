# WalkSync

Find a walking partner in your locality. Express API + vanilla JS front end.

## Run it
```bash
npm install
cp .env.example .env      # set JWT_SECRET to a long random string
npm run seed              # optional demo walkers (password: Walksync123)
npm start                 # http://localhost:3000
npm test                  # API smoke test (temporary database)
```

## What's included
- Accounts: register / login / logout (bcrypt hashing, JWT in an httpOnly SameSite cookie)
- Walker profiles: locality, time, pace, distance, bio, pause/remove listing
- Search by locality, gender preference and time; pagination; saved partners
- Walk requests: send, accept, decline, cancel. Contact email is revealed only after acceptance
- Contact form, live community stats
- Security: helmet + strict CSP, rate limiting, origin check on writes, input validation, no email leakage

## API (all under `/api`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /auth/register, /auth/login, /auth/logout | - | Session handling |
| GET | /auth/me | - | Current user or null |
| GET | /partners?location&gender&time&saved&page&limit | optional | Search listings |
| GET | /locations, /stats | - | Popular localities, counts |
| PUT / DELETE | /profile | yes | Create/update or remove my listing |
| PUT / DELETE | /saved/:partnerId | yes | Save / unsave |
| GET / POST | /requests | yes | My requests / send one |
| PATCH | /requests/:id `{action: accept\|decline\|cancel}` | yes | Respond |
| POST | /contact | - | Contact form |

## Production notes
- Set `NODE_ENV=production` and a strong `JWT_SECRET` (server refuses to start otherwise).
- Data lives in `data/db.json`. For real traffic, replace `server/db.js` with PostgreSQL/MongoDB.
- Serve behind HTTPS (cookies are `Secure` in production). Consider email verification and password reset next.
