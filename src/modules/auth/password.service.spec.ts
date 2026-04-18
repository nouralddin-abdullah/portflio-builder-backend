import { BadRequestException } from '@nestjs/common';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes and verifies a strong password round-trip', async () => {
    const hash = await svc.hash('correct-horse-battery-staple-9');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(svc.verify(hash, 'correct-horse-battery-staple-9')).resolves.toBe(true);
    await expect(svc.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('verify returns false for null hash (OAuth-only account)', async () => {
    await expect(svc.verify(null, 'whatever')).resolves.toBe(false);
  });

  it('rejects passwords shorter than 10 chars', () => {
    expect(() => svc.assertStrength('short')).toThrow(BadRequestException);
  });

  it('rejects oversized passwords', () => {
    expect(() => svc.assertStrength('a'.repeat(257))).toThrow(BadRequestException);
  });

  it('rejects common passwords (case-insensitive)', () => {
    expect(() => svc.assertStrength('Password123')).toThrow(BadRequestException);
  });

  it('accepts a long unique string', () => {
    expect(() => svc.assertStrength('ea9x!Q-purple-horizon-42')).not.toThrow();
  });
});
