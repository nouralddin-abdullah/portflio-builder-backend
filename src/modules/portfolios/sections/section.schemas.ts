import { z } from 'zod';

/**
 * Section schemas mirror the frontend editor's zod contracts. Per the spec
 * they should be synced via a shared workspace package (`@portfoli/contracts`);
 * until that lands we keep the canonical copy here. Schemas are permissive on
 * optional fields and strict on shape keys so unknown fields are rejected.
 */

const trimmedString = (max: number) => z.string().trim().min(1).max(max);
const optionalUrl = z.string().url().max(2048).optional();
const optionalPlainText = (max: number) => z.string().trim().max(max).optional();

export const heroSchema = z
  .object({
    title: trimmedString(120),
    subtitle: optionalPlainText(200),
    ctaLabel: optionalPlainText(40),
    ctaUrl: optionalUrl,
    avatarAssetId: z.string().max(32).optional(),
  })
  .strict();
export type HeroSection = z.infer<typeof heroSchema>;

export const aboutSchema = z
  .object({
    body: z.string().trim().min(1).max(4_000),
    skills: z.array(trimmedString(40)).max(40).optional(),
  })
  .strict();
export type AboutSection = z.infer<typeof aboutSchema>;

const projectItemSchema = z
  .object({
    id: z.string().min(1).max(32),
    title: trimmedString(120),
    summary: optionalPlainText(600),
    url: optionalUrl,
    repoUrl: optionalUrl,
    imageAssetId: z.string().max(32).optional(),
    tags: z.array(trimmedString(30)).max(20).optional(),
  })
  .strict();

export const projectsSchema = z
  .object({
    items: z.array(projectItemSchema).max(30),
  })
  .strict();
export type ProjectsSection = z.infer<typeof projectsSchema>;

const experienceItemSchema = z
  .object({
    id: z.string().min(1).max(32),
    role: trimmedString(120),
    company: trimmedString(120),
    location: optionalPlainText(120),
    startDate: z.string().regex(/^\d{4}-\d{2}$/, 'startDate must be YYYY-MM'),
    endDate: z.string().regex(/^\d{4}-\d{2}$/, 'endDate must be YYYY-MM').optional(),
    summary: optionalPlainText(800),
  })
  .strict()
  .refine(
    (v) => !v.endDate || v.endDate >= v.startDate,
    { message: 'endDate must not precede startDate', path: ['endDate'] },
  );

export const experienceSchema = z
  .object({
    items: z.array(experienceItemSchema).max(20),
  })
  .strict();
export type ExperienceSection = z.infer<typeof experienceSchema>;

const educationItemSchema = z
  .object({
    id: z.string().min(1).max(32),
    institution: trimmedString(160),
    degree: optionalPlainText(120),
    field: optionalPlainText(120),
    startYear: z.number().int().min(1900).max(2100),
    endYear: z.number().int().min(1900).max(2100).optional(),
  })
  .strict()
  .refine(
    (v) => !v.endYear || v.endYear >= v.startYear,
    { message: 'endYear must not precede startYear', path: ['endYear'] },
  );

export const educationSchema = z
  .object({
    items: z.array(educationItemSchema).max(10),
  })
  .strict();
export type EducationSection = z.infer<typeof educationSchema>;

const contactSocialSchema = z
  .object({
    platform: z.enum(['github', 'linkedin', 'x', 'mastodon', 'bluesky', 'dribbble', 'website']),
    url: z.string().url().max(2048),
  })
  .strict();

export const contactSchema = z
  .object({
    email: z.string().email().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    location: optionalPlainText(120),
    socials: z.array(contactSocialSchema).max(8).optional(),
  })
  .strict();
export type ContactSection = z.infer<typeof contactSchema>;

export const SECTION_KINDS = ['hero', 'about', 'projects', 'experience', 'education', 'contact'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const SECTION_SCHEMAS: Record<SectionKind, z.ZodType<unknown>> = {
  hero: heroSchema,
  about: aboutSchema,
  projects: projectsSchema,
  experience: experienceSchema,
  education: educationSchema,
  contact: contactSchema,
};

/**
 * Combined draft shape: every section is optional; each is validated against
 * its own schema when present. Used on write to guarantee the JSONB column
 * always matches the shared contract.
 */
export const draftSchema = z
  .object({
    hero: heroSchema.optional(),
    about: aboutSchema.optional(),
    projects: projectsSchema.optional(),
    experience: experienceSchema.optional(),
    education: educationSchema.optional(),
    contact: contactSchema.optional(),
  })
  .strict();
export type PortfolioDraft = z.infer<typeof draftSchema>;
