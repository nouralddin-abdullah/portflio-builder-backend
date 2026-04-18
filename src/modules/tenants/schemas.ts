import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';

/**
 * Subdomain rules:
 * - 3–32 chars, lowercase letters, digits, hyphens
 * - Must not start or end with a hyphen (DNS label rule)
 * - No consecutive hyphens (looks like a Punycode prefix, confusing)
 * Reserved-name check happens in the service so callers get a clean 409.
 */
const SUBDOMAIN_RE = /^(?!-)(?!.*--)[a-z0-9-]{3,32}(?<!-)$/;

export const subdomainSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SUBDOMAIN_RE, {
      message:
        'Subdomain must be 3-32 chars of lowercase letters, digits, and non-leading/trailing hyphens.',
    }),
});
export type SubdomainInput = z.infer<typeof subdomainSchema>;

@ZodDto(subdomainSchema)
export class SubdomainDto implements SubdomainInput {
  subdomain!: string;
}
