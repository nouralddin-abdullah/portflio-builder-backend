import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

export const tokenSchema = z.object({
  token: z.string().min(20).max(512),
});
export type TokenInput = z.infer<typeof tokenSchema>;

@ZodDto(tokenSchema)
export class TokenDto implements TokenInput {
  token!: string;
}

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

@ZodDto(forgotPasswordSchema)
export class ForgotPasswordDto implements ForgotPasswordInput {
  email!: string;
}

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: z.string().min(10).max(256),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

@ZodDto(resetPasswordSchema)
export class ResetPasswordDto implements ResetPasswordInput {
  token!: string;
  newPassword!: string;
}
