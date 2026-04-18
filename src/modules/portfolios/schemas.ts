import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';
import { SECTION_KINDS } from './sections/section.schemas';
import {
  FONT_PAIR_IDS,
  TEMPLATE_IDS,
  THEME_IDS,
} from '../../database/entities/portfolio.entity';

export const settingsSchema = z
  .object({
    template: z.enum(TEMPLATE_IDS).optional(),
    theme: z.enum(THEME_IDS).optional(),
    fontPair: z.enum(FONT_PAIR_IDS).optional(),
    enabledSections: z.array(z.enum(SECTION_KINDS)).max(SECTION_KINDS.length).optional(),
  })
  .strict();
export type SettingsInput = z.infer<typeof settingsSchema>;

@ZodDto(settingsSchema)
export class SettingsDto implements SettingsInput {
  template?: SettingsInput['template'];
  theme?: SettingsInput['theme'];
  fontPair?: SettingsInput['fontPair'];
  enabledSections?: SettingsInput['enabledSections'];
}

export const revisionsQuerySchema = z
  .object({
    cursor: z.string().max(24).optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((s) => Number.parseInt(s, 10))
      .pipe(z.number().int().min(1).max(50))
      .optional(),
  })
  .strict();
export type RevisionsQueryInput = z.infer<typeof revisionsQuerySchema>;

@ZodDto(revisionsQuerySchema)
export class RevisionsQueryDto implements RevisionsQueryInput {
  cursor?: string;
  limit?: number;
}
