import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

export const configQuerySchema = z.object({
  host: z.string().trim().min(1).max(253),
});
export type ConfigQueryInput = z.infer<typeof configQuerySchema>;

@ZodDto(configQuerySchema)
export class ConfigQueryDto implements ConfigQueryInput {
  host!: string;
}

export const inquirySchema = z
  .object({
    tenantId: z.string().length(24),
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1).max(4_000),
    captchaToken: z.string().min(1).max(2048),
  })
  .strict();
export type InquiryInput = z.infer<typeof inquirySchema>;

@ZodDto(inquirySchema)
export class InquiryDto implements InquiryInput {
  tenantId!: string;
  name!: string;
  email!: string;
  subject?: string;
  body!: string;
  captchaToken!: string;
}

export const pageviewSchema = z
  .object({
    tenantId: z.string().length(24),
    path: z.string().trim().min(1).max(512),
    referrer: z.string().trim().max(2048).optional(),
  })
  .strict();
export type PageviewInput = z.infer<typeof pageviewSchema>;

@ZodDto(pageviewSchema)
export class PageviewDto implements PageviewInput {
  tenantId!: string;
  path!: string;
  referrer?: string;
}
