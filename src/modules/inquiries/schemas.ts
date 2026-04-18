import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

export const listQuerySchema = z
  .object({
    cursor: z.string().max(24).optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((s) => Number.parseInt(s, 10))
      .pipe(z.number().int().min(1).max(100))
      .optional(),
    unread: z
      .enum(['true', 'false'])
      .transform((s) => s === 'true')
      .optional(),
  })
  .strict();
export type ListQueryInput = z.infer<typeof listQuerySchema>;

@ZodDto(listQuerySchema)
export class ListQueryDto implements ListQueryInput {
  cursor?: string;
  limit?: number;
  unread?: boolean;
}
