import { timingSafeEqual } from "node:crypto";
import {
  SessionRepository,
  type Session,
} from "../repositories/session-repository";
import { authKeySchema, sessionTokenSchema } from "../schemas";
import { CryptoService } from "./crypto";
import { ServiceError } from "./errors";

export const SESSION_SECONDS = 12 * 60 * 60;
const ATTEMPT_WINDOW = 10 * 60;
const ATTEMPT_LIMIT = 10;

interface CreatedSession {
  expiresAt: number;
  token: string;
}

interface SessionToken {
  token: string;
  tokenHash: string;
}

export class AuthService {
  private readonly apiKey: string;
  private readonly repository: SessionRepository;

  public constructor({ apiKey, db }: { apiKey: string; db: D1Database }) {
    this.apiKey = apiKey;

    this.repository = new SessionRepository(db);
  }

  public isAuthConfigured(): boolean {
    return authKeySchema.safeParse(this.apiKey).success;
  }

  public async getSessionByToken(
    token: string | null,
  ): Promise<Session | null> {
    const parsed = sessionTokenSchema.safeParse(token);

    if (!parsed.success || !this.isAuthConfigured()) {
      return null;
    }

    const [keyHash, tokenHash] = await Promise.all([
      CryptoService.getHashString(this.apiKey),
      CryptoService.getHashString(parsed.data),
    ]);

    return this.repository.getSessionByTokenHash({
      keyHash,
      now: Math.floor(Date.now() / 1000),
      tokenHash,
    });
  }

  public async createSession({
    clientIp,
    key,
    previousToken,
  }: {
    clientIp: string;
    key: string;
    previousToken: string | null;
  }): Promise<CreatedSession> {
    if (!this.isAuthConfigured()) {
      throw new ServiceError({
        code: "login_failed",
        message:
          "Sign-in is not configured. Add AUTH_API_KEY to the Worker secrets.",
        status: 503,
      });
    }

    const now = Math.floor(Date.now() / 1000);

    const allowed = await this.isLoginAttemptAllowed({ clientIp, now });

    if (!allowed) {
      throw new ServiceError({
        code: "login_failed",
        message: "Too many sign-in attempts. Try again in 10 minutes.",
        retryAfter: ATTEMPT_WINDOW,
        status: 429,
      });
    }

    const [provided, expected] = await Promise.all([
      CryptoService.getDigestBytes(key),
      CryptoService.getDigestBytes(this.apiKey),
    ]);

    if (!timingSafeEqual(provided, expected)) {
      throw new ServiceError({
        code: "login_failed",
        message: "The API key is incorrect.",
        status: 401,
      });
    }

    const expiresAt = now + SESSION_SECONDS;
    const keyHash = CryptoService.getHexString(expected);
    const previous = sessionTokenSchema.safeParse(previousToken);

    const [previousTokenHash, sessionToken] = await Promise.all([
      previous.success ? CryptoService.getHashString(previous.data) : "",
      this.getSessionTokenWithHash(),
    ]);

    const { token, tokenHash } = sessionToken;

    await this.repository.createSession({
      previousTokenHash,
      session: {
        createdAt: now,
        expiresAt,
        keyHash,
        tokenHash,
      },
    });

    return { expiresAt, token };
  }

  public deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    return this.repository.deleteSessionByTokenHash(tokenHash);
  }

  private async getSessionTokenWithHash(): Promise<SessionToken> {
    const token = CryptoService.getHexString(
      crypto.getRandomValues(new Uint8Array(32)),
    );

    const tokenHash = await CryptoService.getHashString(token);

    return { token, tokenHash };
  }

  private async isLoginAttemptAllowed({
    clientIp,
    now,
  }: {
    clientIp: string;
    now: number;
  }): Promise<boolean> {
    const windowStart = Math.floor(now / ATTEMPT_WINDOW) * ATTEMPT_WINDOW;

    const clientHash = await CryptoService.getHashString(
      `${this.apiKey}:${clientIp}`,
    );

    const attempts = await this.repository.getIncrementedLoginAttemptCount({
      clientHash,
      oldestWindow: windowStart - ATTEMPT_WINDOW,
      windowStart,
    });

    return attempts <= ATTEMPT_LIMIT;
  }
}
