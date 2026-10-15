-- 017: staff copilot conversation memory. Threads belong to one staff user
-- (users.id); messages carry the model-visible history plus tool calls and
-- drafts as JSON so a resumed chat continues exactly. No audit rows: these
-- are personal scratch notes, and DELETE is a hard erase for privacy.
CREATE TABLE IF NOT EXISTS assistant_threads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_threads_user ON assistant_threads(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS assistant_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tool_calls JSONB NOT NULL DEFAULT '[]',
  drafts JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread ON assistant_messages(thread_id, id);
