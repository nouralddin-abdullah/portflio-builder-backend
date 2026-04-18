import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

export const RANGE_VALUES = ['7d', '30d', '90d'] as const;
export type Range = (typeof RANGE_VALUES)[number];

const rangeSchema = z.enum(RANGE_VALUES).default('30d');
const limitSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((s) => Number.parseInt(s, 10))
  .pipe(z.number().int().min(1).max(50))
  .optional();

export const overviewQuerySchema = z.object({ range: rangeSchema }).strict();
export type OverviewQueryInput = z.infer<typeof overviewQuerySchema>;

@ZodDto(overviewQuerySchema)
export class OverviewQueryDto implements OverviewQueryInput {
  range!: Range;
}

export const topPagesQuerySchema = z
  .object({ range: rangeSchema, limit: limitSchema })
  .strict();
export type TopPagesQueryInput = z.infer<typeof topPagesQuerySchema>;

@ZodDto(topPagesQuerySchema)
export class TopPagesQueryDto implements TopPagesQueryInput {
  range!: Range;
  limit?: number;
}

export const referrersQuerySchema = z
  .object({ range: rangeSchema, limit: limitSchema })
  .strict();
export type ReferrersQueryInput = z.infer<typeof referrersQuerySchema>;

@ZodDto(referrersQuerySchema)
export class ReferrersQueryDto implements ReferrersQueryInput {
  range!: Range;
  limit?: number;
}

export const countriesQuerySchema = z
  .object({ range: rangeSchema, limit: limitSchema })
  .strict();
export type CountriesQueryInput = z.infer<typeof countriesQuerySchema>;

@ZodDto(countriesQuerySchema)
export class CountriesQueryDto implements CountriesQueryInput {
  range!: Range;
  limit?: number;
}

export function rangeToDays(range: Range): number {
  switch (range) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
  }
}
