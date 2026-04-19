import { z } from 'zod';

/**
 * Section schemas mirror the frontend editor's zod contracts. Per the spec
 * they should be synced via a shared workspace package (`@portfoli/contracts`);
 * until that lands we keep the canonical copy here. Schemas are permissive on
 * optional fields and strict on shape keys so unknown fields are rejected.
 */

const optionalUrlOrEmpty = z.union([z.string().url().max(2048), z.literal('')]).optional();
const optionalPlainText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal('')]).optional();

export const heroSchema = z
  .object({
    portraitUrl: z.union([z.string().max(2048), z.literal('')]).optional(),
    tagline: optionalPlainText(60),
    headline: z.string().trim().min(3).max(140),
    subheadline: z.string().trim().max(300),
    ctaLabel: optionalPlainText(32),
    ctaHref: optionalUrlOrEmpty,
    availability: z.enum(['available', 'limited', 'closed']),
  })
  .strict();
export type HeroSection = z.infer<typeof heroSchema>;

export const aboutSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    skills: z.array(z.string().trim().min(1).max(40)).max(20),
    resumeUrl: optionalUrlOrEmpty,
  })
  .strict();
export type AboutSection = z.infer<typeof aboutSchema>;

const MEDIA_KINDS = ['none', 'image', 'video'] as const;

const projectItemSchema = z
  .object({
    id: z.string().min(1).max(32),
    title: z.string().trim().min(1).max(120),
    summary: z.union([z.string().trim().max(400), z.literal('')]),
    role: optionalPlainText(80),
    client: optionalPlainText(80),
    year: z.string().trim().regex(/^\d{4}$/),
    url: optionalUrlOrEmpty,
    mediaKind: z.enum(MEDIA_KINDS),
    mediaUrl: optionalUrlOrEmpty,
    mediaAlt: optionalPlainText(160),
    tags: z.array(z.string().trim().min(1).max(30)).max(10),
    bullets: z.array(z.string().trim().min(1).max(240)).max(8).optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.mediaKind !== 'none' && !item.mediaUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mediaUrl'],
        message: 'Add a URL or set media to None',
      });
    }
  });

export const projectsSchema = z
  .object({
    items: z.array(projectItemSchema).max(30),
  })
  .strict();
export type ProjectsSection = z.infer<typeof projectsSchema>;

const experienceItemSchema = z
  .object({
    id: z.string().min(1).max(32),
    company: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
    location: optionalPlainText(80),
    start: z.string().trim().min(1).max(40),
    end: z.string().trim().min(1).max(40),
    current: z.boolean(),
    summary: z.union([z.string().trim().max(500), z.literal('')]),
    highlights: z.array(z.string().trim().min(1).max(240)).max(8),
  })
  .strict();

export const experienceSchema = z
  .object({
    items: z.array(experienceItemSchema).max(20),
  })
  .strict();
export type ExperienceSection = z.infer<typeof experienceSchema>;

const educationItemSchema = z
  .object({
    id: z.string().min(1).max(32),
    institution: z.string().trim().min(1).max(160),
    credential: z.string().trim().min(1).max(160),
    startYear: z.string().trim().regex(/^\d{4}$/),
    endYear: z.union([z.string().trim().regex(/^\d{4}$/), z.literal('')]),
    gpa: z.union([z.string().trim().regex(/^(\d(\.\d{1,2})?|)$/u), z.literal('')]).optional(),
    note: optionalPlainText(240),
  })
  .strict();

export const educationSchema = z
  .object({
    items: z.array(educationItemSchema).max(20),
  })
  .strict();
export type EducationSection = z.infer<typeof educationSchema>;

const LINK_PLATFORMS = [
  'website',
  'email',
  'github',
  'gitlab',
  'linkedin',
  'twitter',
  'bluesky',
  'mastodon',
  'instagram',
  'dribbble',
  'behance',
  'figma',
  'youtube',
  'vimeo',
  'medium',
  'substack',
  'spotify',
  'custom',
] as const;

const contactLinkSchema = z
  .object({
    id: z.string().min(1).max(32),
    platform: z.enum(LINK_PLATFORMS),
    label: z.union([z.string().trim().max(40), z.literal('')]),
    href: z.string().trim().min(1).max(2048),
  })
  .strict()
  .superRefine((link, ctx) => {
    if (link.platform === 'email') {
      const ok = z.string().email().safeParse(link.href).success;
      if (!ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['href'], message: 'Enter an email address' });
      }
      return;
    }
    const ok = z.string().url().safeParse(link.href).success;
    if (!ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['href'], message: 'Enter a full URL' });
    }
  });

const phoneField = z
  .union([
    z
      .string()
      .trim()
      .max(32)
      .regex(/^[+\d][\d\s\-().]*$/u),
    z.literal(''),
  ])
  .optional();

export const contactSchema = z
  .object({
    email: z.union([z.string().email().max(254), z.literal('')]),
    phone: phoneField,
    location: optionalPlainText(80),
    links: z.array(contactLinkSchema).max(20),
    allowInquiryForm: z.boolean(),
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
