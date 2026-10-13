import crypto from "node:crypto";

const AES_PREFIX = "enc:";
const KEY_BYTES = 32;

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

export class EncryptionService {
  private key: Buffer | null;
  private _isEnabled: boolean;
  private readonly allowPlaintext: boolean;

  /**
   * `key`: base64url of exactly 32 bytes (e.g. `openssl rand -base64 32`); empty disables
   * encryption. A key of any other length throws at construction (startup), rather than
   * failing at the first encrypt or silently truncating.
   *
   * `allowPlaintext` (default false): accept stored values that lack the `enc:` prefix and
   * return them as-is on decrypt. Only for migrating a database written before encryption
   * was enabled; otherwise a plaintext value under an enabled key is rejected, so a
   * downgrade/plaintext write is not silently accepted.
   */
  constructor(opts: { key: string; allowPlaintext?: boolean }) {
    this.allowPlaintext = opts.allowPlaintext ?? false;
    if (opts.key) {
      const decoded = Buffer.from(opts.key, "base64url");
      if (decoded.length !== KEY_BYTES) {
        throw new Error(
          `DB_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (base64 or base64url); got ${decoded.length}. ` +
            `Generate one with: openssl rand -base64 32`,
        );
      }
      this.key = decoded;
      this._isEnabled = true;
    } else {
      this.key = null;
      this._isEnabled = false;
    }
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  encryptString(plaintext: string): string {
    if (!this.key) return plaintext;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${AES_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  decryptString(ciphertext: string): string {
    if (!this.key) return ciphertext;

    if (!ciphertext.startsWith(AES_PREFIX)) {
      if (this.allowPlaintext) return ciphertext;
      throw new DecryptionError("Value is not encrypted (missing enc: prefix)");
    }

    try {
      const parts = ciphertext.slice(AES_PREFIX.length).split(":");
      if (parts.length !== 3) {
        throw new DecryptionError("Malformed encrypted value");
      }
      const [ivB64, tagB64, dataB64] = parts;
      const iv = Buffer.from(ivB64, "base64url");
      const authTag = Buffer.from(tagB64, "base64url");
      const encrypted = Buffer.from(dataB64, "base64url");

      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(authTag);
      return decipher.update(encrypted) + decipher.final("utf8");
    } catch (err) {
      if (err instanceof DecryptionError) throw err;
      throw new DecryptionError(
        `Decryption failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  encryptJson(data: unknown): string {
    return this.encryptString(JSON.stringify(data));
  }

  decryptJson(ciphertext: string): unknown {
    const plaintext = this.decryptString(ciphertext);
    try {
      return JSON.parse(plaintext);
    } catch {
      return {};
    }
  }
}
