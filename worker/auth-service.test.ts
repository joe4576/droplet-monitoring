import { describe, expect, it, vi } from "vitest";
import { SessionRepository } from "./repositories/session-repository";
import { AuthService } from "./services/auth-service";
import { CryptoService } from "./services/crypto";

describe("session lookup", () => {
  it("starts both hashes before either completes and then queries the repository", async () => {
    let resolveKeyHash!: (value: string) => void;
    let resolveTokenHash!: (value: string) => void;

    const keyHash = new Promise<string>((resolve) => {
      resolveKeyHash = resolve;
    });

    const tokenHash = new Promise<string>((resolve) => {
      resolveTokenHash = resolve;
    });

    const token = "a".repeat(64);
    const session = { expiresAt: 9_999_999_999, tokenHash: "token-hash" };

    const getHash = vi
      .spyOn(CryptoService, "getHashString")
      .mockReturnValueOnce(keyHash)
      .mockReturnValueOnce(tokenHash);

    const getSession = vi
      .spyOn(SessionRepository.prototype, "getSessionByTokenHash")
      .mockResolvedValue(session);

    const service = new AuthService({
      apiKey: "fixture-key",
      db: {} as D1Database,
    });

    const pending = service.getSessionByToken(token);

    expect(getHash).toHaveBeenCalledTimes(2);
    expect(getHash).toHaveBeenNthCalledWith(1, "fixture-key");
    expect(getHash).toHaveBeenNthCalledWith(2, token);
    expect(getSession).not.toHaveBeenCalled();

    resolveKeyHash("key-hash");
    resolveTokenHash("token-hash");

    await expect(pending).resolves.toEqual(session);

    expect(getSession).toHaveBeenCalledWith({
      keyHash: "key-hash",
      now: expect.any(Number),
      tokenHash: "token-hash",
    });
  });
});
