import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

export const MIME_WHITELIST = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type AllowedMime = (typeof MIME_WHITELIST)[number];

export const MAX_ASSET_BYTES = 8 * 1024 * 1024; // 8 MiB

export const signSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^\\/:*?"<>|\r\n]+$/, 'filename contains disallowed characters'),
    mime: z.enum(MIME_WHITELIST),
    byteSize: z.number().int().positive().max(MAX_ASSET_BYTES),
  })
  .strict();
export type SignInput = z.infer<typeof signSchema>;

@ZodDto(signSchema)
export class SignDto implements SignInput {
  filename!: string;
  mime!: AllowedMime;
  byteSize!: number;
}

export const confirmSchema = z
  .object({
    key: z.string().min(10).max(512),
  })
  .strict();
export type ConfirmInput = z.infer<typeof confirmSchema>;

@ZodDto(confirmSchema)
export class ConfirmDto implements ConfirmInput {
  key!: string;
}
