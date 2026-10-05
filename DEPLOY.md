# Deploy checklist (one-time)

Deploy is blocked on exactly one thing: Cloudflare authentication. (`wrangler login`
OAuth does not work from every environment; an API token is the reliable route.)

## Option A — GitHub Actions (recommended, token never touches a dev machine again)

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → template
   **"Edit Cloudflare Workers"** (includes Workers Scripts, D1, R2 edit). Copy it once.
2. Create resources once (dashboard or any logged-in terminal):
   - D1 database `tube2notes-db` → paste its id into `wrangler.toml` (`REPLACE_WITH_YOUR_D1_ID`), commit
   - R2 bucket `tube2notes-audio`
   - Enable Workers AI (dashboard → AI → Workers AI)
3. In this GitHub repo → Settings → Secrets and variables → Actions, add:
   - `CLOUDFLARE_API_TOKEN` (the token from step 1)
   - `CLOUDFLARE_ACCOUNT_ID` (dashboard → Workers & Pages → right sidebar)
4. Actions tab → "Deploy to Cloudflare" → Run workflow. It applies D1 migrations
   remotely, then deploys. Future deploys = re-run the workflow.

## Option B — local wrangler (one-time token, transient)

```bash
export CLOUDFLARE_API_TOKEN=<token>   # this shell only, never commit
npm run db:create                     # paste the D1 id into wrangler.toml
npx wrangler r2 bucket create tube2notes-audio
npm run db:migrate
npm run deploy
```

Either way the app runs in fallback mode until Workers AI is enabled on the
account; after that, summary/notes/flashcards/quiz use Llama 3.3 70B.
