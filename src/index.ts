import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
  AI: any
  AUDIO_BUCKET?: R2Bucket
  ASSETS: Fetcher
  LLM_MODEL?: string
  WHISPER_MODEL?: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

const uid = () => crypto.randomUUID()
const now = () => Date.now()

// ---------- helpers ----------
export function extractVideoId(input: string): string | null {
  if (!input) return null
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

async function fetchYouTubeTranscript(videoId: string): Promise<{ transcript: string; title: string }> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
  const res = await fetch(watchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Accept-Language': 'en-US,en;q=0.9' } })
  if (!res.ok) throw new Error(`YouTube watch page ${res.status}`)
  const html = await res.text()
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  const title = (titleMatch?.[1] || 'YouTube lecture').replace(' - YouTube', '').trim()

  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});<\/script>/s) || html.match(/"captionTracks":(\[.*?\])/)
  let tracks: any[] = []
  if (playerMatch) {
    try {
      const parsed = playerMatch[1].startsWith('{') ? JSON.parse(playerMatch[1]) : null
      tracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks || (playerMatch[1].startsWith('[') ? JSON.parse(playerMatch[1]) : [])
    } catch { /* fall through */ }
  }
  if (!tracks.length) {
    const m2 = html.match(/"captionTracks":(\[.*?\]),"/s)
    if (m2) { try { tracks = JSON.parse(m2[1]) } catch {} }
  }
  if (!tracks.length) throw new Error('No captions found for this video. Try Paste Text mode with a transcript.')

  const track = tracks.find((t: any) => (t.languageCode || '').startsWith('en')) || tracks[0]
  const base = track.baseUrl.replace(/\\u0026/g, '&')
  const jsonUrl = base.includes('fmt=') ? base : `${base}&fmt=json3`
  const capRes = await fetch(jsonUrl)
  if (!capRes.ok) throw new Error(`Caption fetch ${capRes.status}`)
  const data: any = await capRes.json()
  const text = (data.events || [])
    .filter((e: any) => e.segs)
    .map((e: any) => e.segs.map((s: any) => s.utf8).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) throw new Error('Caption track was empty.')
  return { transcript: text, title }
}

const STUDY_PROMPT = (transcript: string) => `You are an expert study tutor. Turn the lecture transcript below into structured study materials.
Return ONLY valid JSON (no markdown fences) with exactly these keys:
{
  "summary": "3-5 sentence summary",
  "notes_md": "Structured markdown notes with ## headings, bullet points, bold key terms",
  "concepts": [{"term":"...","definition":"..."}],
  "flashcards": [{"front":"question","back":"answer"}],
  "quiz": [{"question":"...","options":["A","B","C","D"],"answer_index":0,"explanation":"..."}]
}
Rules: 6-10 concepts, 8-12 flashcards, 5-8 quiz questions. Stay faithful to the transcript; do not invent facts not present.

TRANSCRIPT:
${transcript.slice(0, 12000)}`

function parseAIJson(raw: string): any {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI did not return JSON')
  return JSON.parse(cleaned.slice(start, end + 1))
}

// Deterministic fallback so the app demos end-to-end even without AI quota.
export function fallbackGenerate(transcript: string) {
  const sentences = transcript.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(s => s.length > 30)
  const summary = sentences.slice(0, 4).join(' ')
  const chunks: string[] = []
  for (let i = 0; i < sentences.length; i += 5) chunks.push(sentences.slice(i, i + 5).join(' '))
  const notes_md = chunks.slice(0, 8).map((c, i) => `## Section ${i + 1}\n\n${c}`).join('\n\n') || '## Notes\n\n' + transcript.slice(0, 2000)
  const concepts = sentences.slice(0, 6).map((s, i) => ({ term: `Key point ${i + 1}`, definition: s.slice(0, 220) }))
  const flashcards = sentences.slice(0, 8).map((s, i) => ({ front: `What is explained in point ${i + 1}?`, back: s.slice(0, 220) }))
  const quiz = sentences.slice(0, 5).map((s, i) => ({ question: `Which statement best matches the lecture (item ${i + 1})?`, options: [s.slice(0, 120), 'This topic was not covered', 'The opposite was stated', 'Only mentioned in passing'], answer_index: 0, explanation: s.slice(0, 220) }))
  return { summary, notes_md, concepts, flashcards, quiz }
}

async function logEvent(db: D1Database, type: string, lectureId?: string) {
  try { await db.prepare('INSERT INTO events (id, lecture_id, type, created_at) VALUES (?,?,?,?)').bind(uid(), lectureId || null, type, now()).run() } catch {}
}

// ---------- API ----------
app.get('/api/health', (c) => c.json({ ok: true, service: 'tube2notes', time: new Date().toISOString() }))

app.get('/api/stats', async (c) => {
  const lectures = await c.env.DB.prepare('SELECT COUNT(*) as n FROM lectures').first<any>()
  const gens = await c.env.DB.prepare('SELECT COUNT(*) as n FROM generations').first<any>()
  const subs = await c.env.DB.prepare('SELECT COUNT(*) as n FROM subscribers').first<any>()
  const dash = await c.env.DB.prepare("SELECT COUNT(*) as n FROM events WHERE type='dashboard_reach'").first<any>()
  const done = await c.env.DB.prepare("SELECT COUNT(*) as n FROM events WHERE type='generation_complete'").first<any>()
  return c.json({ lectures: lectures?.n || 0, generations: gens?.n || 0, subscribers: subs?.n || 0, funnel: { dashboard_reach: dash?.n || 0, generation_complete: done?.n || 0 } })
})

app.get('/api/lectures', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, title, source_type, source_url, video_id, length(transcript) as transcript_chars, created_at FROM lectures ORDER BY created_at DESC LIMIT 50').all()
  await logEvent(c.env.DB, 'dashboard_reach')
  return c.json({ lectures: rows.results })
})

app.get('/api/lectures/:id', async (c) => {
  const id = c.req.param('id')
  const lecture = await c.env.DB.prepare('SELECT * FROM lectures WHERE id=?').bind(id).first<any>()
  if (!lecture) return c.json({ error: 'not_found' }, 404)
  const gen = await c.env.DB.prepare('SELECT * FROM generations WHERE lecture_id=? ORDER BY created_at DESC LIMIT 1').bind(id).first<any>()
  const generation = gen ? { ...gen, concepts: JSON.parse(gen.concepts_json || '[]'), flashcards: JSON.parse(gen.flashcards_json || '[]'), quiz: JSON.parse(gen.quiz_json || '[]') } : null
  return c.json({ lecture, generation })
})

app.post('/api/lectures', async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const sourceType = body.sourceType as string
  let title = (body.title || '').trim(), transcript = (body.transcript || '').trim(), sourceUrl = body.url || null, videoId: string | null = null

  if (sourceType === 'youtube') {
    videoId = extractVideoId(body.url || '')
    if (!videoId) return c.json({ error: 'invalid_youtube_url' }, 400)
    try {
      const out = await fetchYouTubeTranscript(videoId)
      transcript = out.transcript; if (!title) title = out.title
    } catch (e: any) { return c.json({ error: 'transcript_failed', detail: String(e?.message || e) }, 422) }
  } else if (sourceType === 'text') {
    if (transcript.length < 80) return c.json({ error: 'transcript_too_short', detail: 'Paste at least ~80 characters.' }, 400)
    if (!title) title = 'Pasted transcript'
  } else {
    return c.json({ error: 'unsupported_source_type', detail: 'Use youtube, text, or /api/upload for audio.' }, 400)
  }

  const id = uid()
  await c.env.DB.prepare('INSERT INTO lectures (id, title, source_type, source_url, video_id, transcript, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, title || 'Untitled lecture', sourceType, sourceUrl, videoId, transcript, now()).run()
  await logEvent(c.env.DB, 'lecture_created', id)
  return c.json({ id, title, transcript_chars: transcript.length })
})

app.post('/api/upload', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file) return c.json({ error: 'no_file' }, 400)
  const buf = new Uint8Array(await file.arrayBuffer())
  if (c.env.AUDIO_BUCKET) { try { await c.env.AUDIO_BUCKET.put(`audio/${uid()}-${file.name}`, buf) } catch {} }
  let transcript = ''
  try {
    // Workers AI Whisper expects base64 audio in many runtimes; array input also accepted on newer models.
    const out: any = await c.env.AI.run(c.env.WHISPER_MODEL || '@cf/openai/whisper-large-v3-turbo', { audio: [...buf] })
    transcript = out?.text || ''
  } catch (e: any) {
    return c.json({ error: 'transcription_failed', detail: String(e?.message || e), hint: 'Try a smaller mp3/wav, or use Paste Text mode.' }, 422)
  }
  if (!transcript) return c.json({ error: 'empty_transcript' }, 422)
  const id = uid(); const title = (form?.get('title') as string) || file.name
  await c.env.DB.prepare('INSERT INTO lectures (id, title, source_type, source_url, video_id, transcript, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, title, 'audio', null, null, transcript, now()).run()
  await logEvent(c.env.DB, 'lecture_created', id)
  return c.json({ id, title, transcript_chars: transcript.length })
})

app.post('/api/lectures/:id/generate', async (c) => {
  const id = c.req.param('id')
  const lecture = await c.env.DB.prepare('SELECT * FROM lectures WHERE id=?').bind(id).first<any>()
  if (!lecture) return c.json({ error: 'not_found' }, 404)
  let result: any; let model = c.env.LLM_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'; let usedFallback = false
  try {
    const out: any = await c.env.AI.run(model, { messages: [{ role: 'user', content: STUDY_PROMPT(lecture.transcript) }], max_tokens: 4096 })
    const raw = out?.response || out?.result?.response || (typeof out === 'string' ? out : '')
    result = parseAIJson(raw)
  } catch { result = fallbackGenerate(lecture.transcript); usedFallback = true; model = 'fallback-extractive' }
  const gid = uid()
  await c.env.DB.prepare('INSERT INTO generations (id, lecture_id, summary, notes_md, concepts_json, flashcards_json, quiz_json, model, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(gid, id, result.summary || '', result.notes_md || '', JSON.stringify(result.concepts || []), JSON.stringify(result.flashcards || []), JSON.stringify(result.quiz || []), model, now()).run()
  await logEvent(c.env.DB, 'generation_complete', id)
  return c.json({ generation_id: gid, model, used_fallback: usedFallback, generation: { summary: result.summary, notes_md: result.notes_md, concepts: result.concepts || [], flashcards: result.flashcards || [], quiz: result.quiz || [] } })
})

app.post('/api/subscribe', async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'invalid_email' }, 400)
  try { await c.env.DB.prepare('INSERT INTO subscribers (id, email, created_at) VALUES (?,?,?)').bind(uid(), email, now()).run() } catch { return c.json({ ok: true, already: true }) }
  return c.json({ ok: true })
})

export default app
