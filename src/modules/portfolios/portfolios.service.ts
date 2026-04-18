import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository, type FindOptionsWhere } from 'typeorm';
import { ZodError, type ZodType } from 'zod';
import { Portfolio } from '../../database/entities/portfolio.entity';
import type {
  FontPairId,
  TemplateId,
  ThemeId,
} from '../../database/entities/portfolio.entity';
import { PortfolioRevision } from '../../database/entities/portfolio-revision.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { EventBus } from '../../common/events/event-bus.service';
import type { SettingsInput } from './schemas';
import {
  SECTION_KINDS,
  SECTION_SCHEMAS,
  draftSchema,
  type PortfolioDraft,
  type SectionKind,
} from './sections/section.schemas';

export interface PortfolioSummary {
  id: string;
  tenantId: string;
  template: TemplateId;
  theme: ThemeId;
  fontPair: FontPairId;
  enabledSections: string[];
  draft: PortfolioDraft;
  published: PortfolioDraft | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionSummary {
  id: string;
  portfolioId: string;
  publishedAt: string;
  publishedBy: string;
}

export interface PaginatedRevisions {
  items: RevisionSummary[];
  nextCursor: string | null;
}

@Injectable()
export class PortfoliosService {
  constructor(
    @InjectRepository(Portfolio) private readonly portfolios: Repository<Portfolio>,
    @InjectRepository(PortfolioRevision) private readonly revisions: Repository<PortfolioRevision>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly events: EventBus,
  ) {}

  async getForUser(userId: string): Promise<PortfolioSummary> {
    const { portfolio } = await this.resolve(userId);
    return this.toSummary(portfolio);
  }

  async updateSettings(userId: string, patch: SettingsInput): Promise<PortfolioSummary> {
    const { portfolio } = await this.resolve(userId);
    if (patch.template !== undefined) portfolio.template = patch.template;
    if (patch.theme !== undefined) portfolio.theme = patch.theme;
    if (patch.fontPair !== undefined) portfolio.fontPair = patch.fontPair;
    if (patch.enabledSections !== undefined) {
      portfolio.enabledSections = [...new Set(patch.enabledSections)];
    }
    await this.portfolios.save(portfolio);
    return this.toSummary(portfolio);
  }

  /**
   * Parse-validates the incoming body against the per-kind section schema,
   * merges into `draft`, then re-parses the whole draft so the JSONB column
   * is always contract-clean.
   */
  async upsertSection(userId: string, kind: string, body: unknown): Promise<PortfolioSummary> {
    const sectionKind = this.assertSectionKind(kind);
    const schema: ZodType<unknown> = SECTION_SCHEMAS[sectionKind];
    const parsed: unknown = this.safeParse(schema, body);

    const { portfolio } = await this.resolve(userId);
    const draft: Record<string, unknown> = { ...(portfolio.draft ?? {}) };
    draft[sectionKind] = parsed;
    portfolio.draft = this.safeParse(draftSchema, draft);
    await this.portfolios.save(portfolio);
    return this.toSummary(portfolio);
  }

  async deleteSection(userId: string, kind: string): Promise<PortfolioSummary> {
    const sectionKind = this.assertSectionKind(kind);
    const { portfolio } = await this.resolve(userId);
    const draft: Record<string, unknown> = { ...(portfolio.draft ?? {}) };
    delete draft[sectionKind];
    portfolio.draft = this.safeParse(draftSchema, draft);
    await this.portfolios.save(portfolio);
    return this.toSummary(portfolio);
  }

  /**
   * Snapshots draft → published, writes a PortfolioRevision, bumps the
   * tenant status to `published`, and emits `portfolio.published` so the
   * public-config cache can invalidate.
   */
  async publish(userId: string): Promise<PortfolioSummary> {
    const { portfolio, tenant } = await this.resolve(userId);
    // Validate the draft against the canonical shape, scoped to
    // enabledSections so authors can't publish with required sections missing.
    const draft = this.safeParse(draftSchema, portfolio.draft ?? {});
    for (const kind of portfolio.enabledSections as SectionKind[]) {
      if (!Object.prototype.hasOwnProperty.call(draft, kind)) {
        throw new UnprocessableEntityException({
          code: 'section_missing',
          message: `Enabled section "${kind}" is missing from the draft.`,
          details: { section: kind },
        });
      }
    }

    const snapshot: PortfolioDraft = structuredClone(draft);
    const publishedAt = new Date();
    portfolio.published = snapshot;
    portfolio.publishedAt = publishedAt;
    await this.portfolios.save(portfolio);

    const revision = this.revisions.create({
      portfolioId: portfolio.id,
      snapshot,
      publishedBy: userId,
    });
    await this.revisions.save(revision);

    tenant.status = 'published';
    await this.tenants.save(tenant);

    this.events.emit('portfolio.published', {
      tenantId: tenant.id,
      portfolioId: portfolio.id,
      subdomain: tenant.subdomain,
      customDomain: tenant.customDomain,
    });

    return this.toSummary(portfolio);
  }

  async unpublish(userId: string): Promise<PortfolioSummary> {
    const { portfolio, tenant } = await this.resolve(userId);
    portfolio.published = null;
    portfolio.publishedAt = null;
    await this.portfolios.save(portfolio);

    tenant.status = 'archived';
    await this.tenants.save(tenant);

    this.events.emit('portfolio.unpublished', {
      tenantId: tenant.id,
      portfolioId: portfolio.id,
      subdomain: tenant.subdomain,
      customDomain: tenant.customDomain,
    });
    return this.toSummary(portfolio);
  }

  /**
   * Cursor pagination on `publishedAt DESC, id DESC`. The cursor is the last
   * row's id from the previous page.
   */
  async listRevisions(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PaginatedRevisions> {
    const { portfolio } = await this.resolve(userId);
    const where: FindOptionsWhere<PortfolioRevision> = {
      portfolioId: portfolio.id,
    };
    if (cursor) {
      const cursorRow = await this.revisions.findOne({ where: { id: cursor } });
      if (cursorRow && cursorRow.portfolioId === portfolio.id) {
        where.publishedAt = LessThan(cursorRow.publishedAt);
      }
    }
    const rows = await this.revisions.find({
      where,
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      portfolioId: r.portfolioId,
      publishedAt: r.publishedAt.toISOString(),
      publishedBy: r.publishedBy,
    }));
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async restoreRevision(userId: string, revisionId: string): Promise<PortfolioSummary> {
    const { portfolio } = await this.resolve(userId);
    const revision = await this.revisions.findOne({ where: { id: revisionId } });
    if (!revision || revision.portfolioId !== portfolio.id) {
      throw new NotFoundException({ code: 'revision_not_found', message: 'Revision not found.' });
    }
    portfolio.draft = this.safeParse(draftSchema, revision.snapshot);
    await this.portfolios.save(portfolio);
    return this.toSummary(portfolio);
  }

  private async resolve(userId: string): Promise<{ portfolio: Portfolio; tenant: Tenant }> {
    const tenant = await this.tenants.findOne({ where: { ownerId: userId } });
    if (!tenant) {
      throw new NotFoundException({
        code: 'tenant_missing',
        message: 'Create a tenant first via GET /api/tenant.',
      });
    }
    let portfolio = await this.portfolios.findOne({ where: { tenantId: tenant.id } });
    if (!portfolio) {
      portfolio = this.portfolios.create({
        tenantId: tenant.id,
        template: 'minimal',
        theme: 'ink',
        fontPair: 'editorial',
        enabledSections: [],
        draft: {},
        published: null,
        publishedAt: null,
      });
      await this.portfolios.save(portfolio);
    }
    return { portfolio, tenant };
  }

  private assertSectionKind(kind: string): SectionKind {
    if ((SECTION_KINDS as readonly string[]).includes(kind)) return kind as SectionKind;
    throw new BadRequestException({
      code: 'unknown_section',
      message: `Unknown section "${kind}".`,
      details: { allowed: SECTION_KINDS.join(',') },
    });
  }

  private safeParse<T>(schema: ZodType<T>, value: unknown): T {
    try {
      return schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        const details: Record<string, string> = {};
        for (const issue of err.issues) {
          const path = issue.path.join('.') || '(root)';
          if (!details[path]) details[path] = issue.message;
        }
        throw new UnprocessableEntityException({
          code: 'validation_error',
          message: 'Section body failed validation.',
          details,
        });
      }
      throw err;
    }
  }

  private toSummary(p: Portfolio): PortfolioSummary {
    return {
      id: p.id,
      tenantId: p.tenantId,
      template: p.template,
      theme: p.theme,
      fontPair: p.fontPair,
      enabledSections: p.enabledSections,
      draft: (p.draft ?? {}) as PortfolioDraft,
      published: (p.published ?? null) as PortfolioDraft | null,
      publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
