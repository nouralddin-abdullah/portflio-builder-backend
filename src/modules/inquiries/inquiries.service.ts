import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository, type FindOptionsWhere, IsNull } from 'typeorm';
import { Inquiry } from '../../database/entities/inquiry.entity';
import { Tenant } from '../../database/entities/tenant.entity';

export interface InquirySummary {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  subject: string | null;
  bodyPreview: string;
  readAt: string | null;
  createdAt: string;
}

export interface InquiryDetail extends InquirySummary {
  body: string;
}

export interface PaginatedInquiries {
  items: InquirySummary[];
  nextCursor: string | null;
}

const PREVIEW_LEN = 140;

@Injectable()
export class InquiriesService {
  constructor(
    @InjectRepository(Inquiry) private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  async list(
    userId: string,
    opts: { cursor?: string; limit?: number; unread?: boolean } = {},
  ): Promise<PaginatedInquiries> {
    const tenant = await this.resolveTenant(userId);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const where: FindOptionsWhere<Inquiry> = { tenantId: tenant.id };
    if (opts.unread) where.readAt = IsNull();
    if (opts.cursor) {
      const cursorRow = await this.inquiries.findOne({ where: { id: opts.cursor } });
      if (cursorRow && cursorRow.tenantId === tenant.id) {
        where.createdAt = LessThan(cursorRow.createdAt);
      }
    }
    const rows = await this.inquiries.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((r) => this.toSummary(r)),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async detail(userId: string, inquiryId: string): Promise<InquiryDetail> {
    const row = await this.loadOwned(userId, inquiryId);
    return { ...this.toSummary(row), body: row.body };
  }

  async markRead(userId: string, inquiryId: string): Promise<InquiryDetail> {
    const row = await this.loadOwned(userId, inquiryId);
    if (!row.readAt) {
      row.readAt = new Date();
      await this.inquiries.save(row);
    }
    return { ...this.toSummary(row), body: row.body };
  }

  async delete(userId: string, inquiryId: string): Promise<void> {
    const row = await this.loadOwned(userId, inquiryId);
    await this.inquiries.remove(row);
  }

  /**
   * Loads an inquiry if the caller's tenant owns it. Collapses "not found"
   * and "not yours" into the same 404 — don't leak existence of other
   * tenants' inquiries.
   */
  private async loadOwned(userId: string, inquiryId: string): Promise<Inquiry> {
    const tenant = await this.resolveTenant(userId);
    const row = await this.inquiries.findOne({ where: { id: inquiryId } });
    if (!row || row.tenantId !== tenant.id) {
      throw new NotFoundException({ code: 'inquiry_not_found', message: 'Inquiry not found.' });
    }
    return row;
  }

  private async resolveTenant(userId: string): Promise<Tenant> {
    const tenant = await this.tenants.findOne({ where: { ownerId: userId } });
    if (!tenant) {
      throw new ForbiddenException({
        code: 'tenant_missing',
        message: 'Create a tenant first via GET /api/tenant.',
      });
    }
    return tenant;
  }

  private toSummary(row: Inquiry): InquirySummary {
    const body = row.body ?? '';
    const trimmed = body.length > PREVIEW_LEN ? `${body.slice(0, PREVIEW_LEN - 1)}…` : body;
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      email: row.email,
      subject: row.subject,
      bodyPreview: trimmed,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

