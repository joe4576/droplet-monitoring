export interface Session {
  expiresAt: number;
  tokenHash: string;
}

interface SessionRecord extends Session {
  createdAt: number;
  keyHash: string;
}

export class SessionRepository {
  public constructor(private readonly db: D1Database) {}

  public async getSessionByTokenHash({
    keyHash,
    now,
    tokenHash,
  }: {
    keyHash: string;
    now: number;
    tokenHash: string;
  }): Promise<Session | null> {
    const row = await this.db
      .prepare(
        "SELECT expires_at FROM sessions WHERE token_hash = ?1 AND key_hash = ?2 AND expires_at > ?3",
      )
      .bind(tokenHash, keyHash, now)
      .first<{
        expires_at: number;
      }>();

    return row ? { expiresAt: row.expires_at, tokenHash } : null;
  }

  public async createSession({
    previousTokenHash,
    session,
  }: {
    previousTokenHash: string;
    session: SessionRecord;
  }): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          "DELETE FROM sessions WHERE expires_at <= ?1 OR token_hash = ?2",
        )
        .bind(session.createdAt, previousTokenHash),
      this.db
        .prepare(
          "INSERT INTO sessions (token_hash, key_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(
          session.tokenHash,
          session.keyHash,
          session.createdAt,
          session.expiresAt,
        ),
    ]);
  }

  public async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM sessions WHERE token_hash = ?1")
      .bind(tokenHash)
      .run();
  }

  public async getIncrementedLoginAttemptCount({
    clientHash,
    oldestWindow,
    windowStart,
  }: {
    clientHash: string;
    oldestWindow: number;
    windowStart: number;
  }): Promise<number> {
    const result = await this.db.batch<{
      attempts: number;
    }>([
      this.db
        .prepare("DELETE FROM login_attempts WHERE window_start < ?1")
        .bind(oldestWindow),
      this.db
        .prepare(
          "INSERT INTO login_attempts (client_hash, window_start, attempts) VALUES (?1, ?2, 1) ON CONFLICT (client_hash, window_start) DO UPDATE SET attempts = attempts + 1 RETURNING attempts",
        )
        .bind(clientHash, windowStart),
    ]);

    return result[1].results[0]?.attempts ?? Infinity;
  }
}
