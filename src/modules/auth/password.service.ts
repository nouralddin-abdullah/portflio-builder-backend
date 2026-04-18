import { BadRequestException, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * argon2id settings tuned to the spec:
 *   memoryCost = 19 MiB, timeCost = 2, parallelism = 1.
 * On a typical commodity core this lands ~30ms/hash — fast enough for a login
 * hot path, slow enough to make offline brute force expensive.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const MIN_PASSWORD_LEN = 10;
const MAX_PASSWORD_LEN = 256;

@Injectable()
export class PasswordService {
  /** Throws UnprocessableEntity-ish on weakness. Returns the argon2id hash. */
  async hash(plaintext: string): Promise<string> {
    this.assertStrength(plaintext);
    return argon2.hash(plaintext, ARGON2_OPTIONS);
  }

  /**
   * Constant-time verify. Returns false when hash is null (OAuth-only accounts)
   * so the caller can present a single "invalid credentials" error.
   */
  async verify(hash: string | null, plaintext: string): Promise<boolean> {
    if (!hash) return false;
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  /**
   * Enforces min length + rejects a tiny blocklist of ultra-common passwords.
   * The full zxcvbn + top-10k list check lands in T13 so we don't block T3 on
   * the ~800KB wordlist bundling.
   */
  assertStrength(plaintext: string): void {
    if (plaintext.length < MIN_PASSWORD_LEN) {
      throw new BadRequestException({
        code: 'weak_password',
        message: `Password must be at least ${MIN_PASSWORD_LEN} characters.`,
      });
    }
    if (plaintext.length > MAX_PASSWORD_LEN) {
      throw new BadRequestException({
        code: 'weak_password',
        message: `Password must be at most ${MAX_PASSWORD_LEN} characters.`,
      });
    }
    if (COMMON_PASSWORDS.has(plaintext.toLowerCase())) {
      throw new BadRequestException({
        code: 'weak_password',
        message: 'This password is too common. Pick something harder to guess.',
      });
    }
  }
}

/** Interim blocklist; expanded to the top-10k in T13. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'welcome123',
  'admin12345',
  'iloveyou12',
  '123123123123',
]);
