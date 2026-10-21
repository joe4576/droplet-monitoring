CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE login_attempts (
  client_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (client_hash, window_start)
);
CREATE INDEX login_attempts_window_start ON login_attempts (window_start);
