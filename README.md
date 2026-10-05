# tube2notes

**Open-source AI Video/Audio Study Tool on Cloudflare** — turn YouTube lectures & audio into structured study material: summary, structured notes, key concepts, flashcards and quizzes.

A Cloudflare-native, MIT-licensed alternative to closed micro-SaaS study tools (the kind listed for sale at ~$2.3K ARR with 3.5K users on Next.js + Python + Supabase). Same core job, zero servers to manage, deployable in minutes.

![stack](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1%20%2B%20R2%20%2B%20Workers%20AI-orange)

## What it does

1. **Input** — paste a YouTube URL (auto transcript), upload audio (mp3/wav/m4a, Whisper transcription), or paste a transcript directly
2. **Generate** — Workers AI (Llama 3.3 70B) builds a study pack:
   - 📝 Summary (3–5 sentences)
   - 📚 Structured notes (markdown, headings + bullets)
   - 🔑 Key concepts & definitions
   - 🃏 Flashcards (click-to-flip, prev/next)
   - ❓ Quiz (multiple choice, instant grading + explanations)
3. **Revise** — dashboard history, shareable link per lecture (`/?id=...`), Markdown export
4. **Grow** — built-in email capture + funnel events (`dashboard_reach` / `generation_complete`, the same funnel the original product reported at 44% / 18%)

If Workers AI quota is unavailable, a deterministic extractive fallback still produces a full pack so the demo never hard-fails.

## Architecture (Cloudflare-native)

| Layer | Original (for-sale SaaS) | tube2notes |
|---|---|---|
| Frontend | Next.js | Static assets on Workers (single-page app) |
| API | Python | Hono on Cloudflare Workers (TypeScript) |
| DB | Supabase (Postgres) | Cloudflare D1 (SQLite) |
| Files | — | R2 (uploaded audio) |
| Transcription | (Python pipeline) | Workers AI Whisper Large v3 Turbo |
| LLM | (hosted API) | Workers AI Llama 3.3 70B Instruct |
| Hosting bill | VPS + Supabase | Workers free/paid tier, scales to zero |

```
YouTube URL ──► Worker fetches captions (no API key) ──┐
Audio upload ─► R2 + Whisper transcription ────────────┼─► transcript ─► D1
Paste text ────────────────────────────────────────────┘        │
                                                                ▼
                                          Workers AI LLM ─► study pack (JSON) ─► D1 ─► UI
```

## Quick start

```bash
git clone https://github.com/tuannx/tube2notes.git
cd tube2notes
npm install

# 1) Create D1 and paste its id into wrangler.toml (REPLACE_WITH_YOUR_D1_ID)
npm run db:create

# 2) Apply migrations
npm run db:migrate:local   # local dev
npm run db:migrate         # remote

# 3) Run
npm run dev    # http://localhost:8787
npm run deploy # production on your Cloudflare account
```

Enable **Workers AI** on your Cloudflare account (dashboard → AI → Workers AI) for full-quality generation. R2 bucket creation: `npx wrangler r2 bucket create tube2notes-audio`.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/lectures` | List recent lectures (+ logs `dashboard_reach`) |
| POST | `/api/lectures` | Create from `{sourceType:"youtube",url}` or `{sourceType:"text",title,transcript}` |
| POST | `/api/upload` | Multipart audio upload → Whisper transcript → lecture |
| POST | `/api/lectures/:id/generate` | Generate/re-generate study pack |
| GET | `/api/lectures/:id` | Lecture + latest generation |
| POST | `/api/subscribe` | Email capture `{email}` |
| GET | `/api/stats` | Counts + funnel |

## Tests

```bash
npm test   # node --test — video-id parsing + fallback generator
```

## Roadmap

- [ ] Chapter/timeline view synced to video timestamps
- [ ] Anki (.apkg) export
- [ ] Spaced-repetition review mode
- [ ] Multi-language transcripts & notes
- [ ] Optional BYO-LLM (OpenAI/Anthropic key in settings)
- [ ] Auth + private libraries

## License

MIT — see [LICENSE](./LICENSE). Built as an open-source equivalent for learning and self-hosting; not affiliated with any product listed for sale.
