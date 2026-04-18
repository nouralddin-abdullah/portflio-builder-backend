import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    headline: z.string().trim().max(280).nullable().optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    location: z.string().trim().max(120).nullable().optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

@ZodDto(updateProfileSchema)
export class UpdateProfileDto implements UpdateProfileInput {
  name?: string;
  headline?: string | null;
  avatarUrl?: string | null;
  location?: string | null;
}

export const emailChangeSchema = z.object({
  newEmail: z.string().email().max(254),
});
export type EmailChangeInput = z.infer<typeof emailChangeSchema>;

@ZodDto(emailChangeSchema)
export class EmailChangeDto implements EmailChangeInput {
  newEmail!: string;
}

export const passwordChangeSchema = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(10).max(256),
});
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

@ZodDto(passwordChangeSchema)
export class PasswordChangeDto implements PasswordChangeInput {
  current!: string;
  next!: string;
}

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(256),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

@ZodDto(deleteAccountSchema)
export class DeleteAccountDto implements DeleteAccountInput {
  password!: string;
}
