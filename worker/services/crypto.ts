export class CryptoService {
  private constructor() {}

  public static async getDigestBytes(value: string): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  }

  public static getHexString(bytes: Uint8Array): string {
    let result = "";

    for (const byte of bytes) {
      result += byte.toString(16).padStart(2, "0");
    }

    return result;
  }

  public static async getHashString(value: string): Promise<string> {
    return this.getHexString(await this.getDigestBytes(value));
  }
}
