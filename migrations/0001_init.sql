CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled lecture',
  source_type TEXT NOT NULL CHECK (source_type IN ('youtube','text','audio')),
  source_url TEXT,
  video_id TEXT,
  transcript TEXT NOT NULL DEFAULT '',
  language TEXT DEFAULT 'en',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  notes_md TEXT NOT NULL DEFAULT '',
  concepts_json TEXT NOT NULL DEFAULT '[]',
  flashcards_json TEXT NOT NULL DEFAULT '[]',
  quiz_json TEXT NOT NULL DEFAULT '[]',
  model TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generations_lecture ON generations(lecture_id, created_at DESC);

-- Funnel events (mirrors the original product's dashboard_reach / first_generation funnel)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  lecture_id TEXT,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
