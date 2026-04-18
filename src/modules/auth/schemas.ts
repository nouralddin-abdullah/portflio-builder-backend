import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(256),
  name: z.string().trim().min(1).max(120),
});
export type RegisterInput = z.infer<typeof registerSchema>;

@ZodDto(registerSchema)
export class RegisterDto implements RegisterInput {
  email!: string;
  password!: string;
  name!: string;
}

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

@ZodDto(loginSchema)
export class LoginDto implements LoginInput {
  email!: string;
  password!: string;
}

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

@ZodDto(refreshSchema)
export class RefreshDto implements RefreshInput {
  refreshToken!: string;
}

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

@ZodDto(logoutSchema)
export class LogoutDto implements LogoutInput {
  refreshToken!: string;
}
