# Deploying theunivers.ai

One process serves everything: the marketing site, `/app`, and the API. `server/index.mjs` serves
`dist/` with an SPA fallback, so there is no second origin, no CORS, and cookies live on one domain.

## The loop

```bash
npm run dev:all      # localhost:5188 (site) + localhost:8790 (api)
# … edit, test …
npm run deploy       # build + fly deploy   → https://theunivers.ai
```

That is the whole cycle. Everything below is one-time setup.

---

## One-time setup

### 1. Install Fly and sign in

```bash
brew install flyctl
fly auth login          # opens a browser
```

A payment card is required even on the smallest size. Expect roughly **$2–5/month** for one
shared-cpu-1x machine with a 1 GB volume.

### 2. Create the app and its disk

```bash
cd ~/Studio/projects/theunivers-ai
fly launch --no-deploy --copy-config --name theunivers-ai
fly volumes create theunivers_data --size 1 --region cdg
```

`--copy-config` uses the `fly.toml` in this repo. **Say no** if it offers to create a Postgres or
Redis — this uses SQLite on the volume.

> The volume is not optional. Without it the database is recreated on every deploy and every
> account, agent and receipt vanishes — silently, because the app starts up perfectly well.

### 3. Set the secrets

Nothing secret goes in `fly.toml` or the Dockerfile; both are committed.

```bash
fly secrets set \
  GOOGLE_CLIENT_ID="…apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="GOCSPX-…" \
  OAUTH_STATE_SECRET="$(openssl rand -hex 32)" \
  INVITE_CODE="$(openssl rand -hex 8)"
```

Note the invite code is generated, not `univers-pilot`. The old one is in a chat transcript and
was baked into the Docker image; treat it as public.

Add GitHub's pair too when you have them, and `SMTP_*` when you want real password-reset email.

### 4. First deploy

```bash
npm run deploy
fly logs                       # watch it boot
curl https://theunivers-ai.fly.dev/api/health
```

You should see `"ok": true` and `"google": true`.

### 5. Point the domain

```bash
fly certs create theunivers.ai
fly certs create www.theunivers.ai
fly ips list                   # the A and AAAA to use
```

Then in **GoDaddy → DNS**, replace the four GitHub Pages `A` records:

| Type | Name | Value |
|---|---|---|
| A | @ | the IPv4 from `fly ips list` |
| AAAA | @ | the IPv6 from `fly ips list` |
| CNAME | www | `theunivers-ai.fly.dev` |

Delete the old `185.199.*` records and the `thegreatest-ai.github.io` CNAME, or the domain will
keep resolving to the stale static site.

Certificates issue automatically once DNS propagates — usually minutes, occasionally an hour.
Check with `fly certs show theunivers.ai`.

### 6. Add the production OAuth callback

In **Google Cloud → Google Auth Platform → Clients → your client**, add:

```
https://theunivers.ai/api/auth/google/callback
```

**Keep the localhost one alongside it.** A client holds several, and you need both to keep
developing. Same for the JavaScript origin: add `https://theunivers.ai`.

---

## Things that will bite

**GitHub Pages is disabled, not deleted.** `.github/workflows/deploy.yml` is now manual-dispatch
only. If it ever runs again it will publish a static build over the top — a site whose sign-in
looks real and cannot work, because static hosting has no API.

**`INVITE_REQUIRED=true` in production**, set in `fly.toml`. Locally it is `false` for convenience.
Deploying with it open means anyone can create an account on a product that has never met a
stranger.

**One machine, one SQLite file.** Do not scale to two — both would open their own copy of the
database on separate volumes and diverge. `min_machines_running = 1` and no autoscaling is
deliberate. Outgrowing that means moving to Postgres, not adding machines.

**Check the secrets landed** without printing them:

```bash
npm run secrets:check
```
