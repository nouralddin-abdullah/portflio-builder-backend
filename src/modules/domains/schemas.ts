import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

/**
 * RFC-1123 hostname: dot-separated labels, each 1–63 chars, starting and
 * ending with an alphanumeric, hyphens internal. Total length <= 253. We
 * also forbid a trailing dot and any uppercase (users paste addresses
 * copied from browsers — normalize aggressively).
 */
const DOMAIN_RE =
  /^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const customDomainSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(DOMAIN_RE, { message: 'Enter a valid domain (e.g. example.com).' }),
  })
  .strict();
export type CustomDomainInput = z.infer<typeof customDomainSchema>;

@ZodDto(customDomainSchema)
export class CustomDomainDto implements CustomDomainInput {
  domain!: string;
}
