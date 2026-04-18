import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { extname } from 'node:path';
import { Asset, type AssetDerivative } from '../../database/entities/asset.entity';
import { Portfolio } from '../../database/entities/portfolio.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { createId } from '../../database/id';
import { EventBus } from '../../common/events/event-bus.service';
import { R2Service, type PresignedPut } from './r2.service';
import { AssetsQueue } from './assets.queue';
import { MAX_ASSET_BYTES, MIME_WHITELIST, type AllowedMime, type SignInput } from './schemas';

export interface AssetSummary {
  id: string;
  key: string;
  url: string;
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  derivatives: AssetDerivative[];
  createdAt: string;
}

const MIME_EXT: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(Portfolio) private readonly portfolios: Repository<Portfolio>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly r2: R2Service,
    private readonly queue: AssetsQueue,
    private readonly events: EventBus,
  ) {}

  /**
   * Issues a 5-minute pre-signed PUT against R2. Keying scheme is
   * `u/<userId>/p/<portfolioId>/<cuid>.<ext>` — scopable by prefix per
   * user/portfolio so a batch-delete on account removal is cheap.
   */
  async sign(userId: string, input: SignInput): Promise<PresignedPut & { maxBytes: number }> {
    if (input.byteSize > MAX_ASSET_BYTES) {
      throw new BadRequestException({
        code: 'asset_too_large',
        message: `File must be ≤ ${MAX_ASSET_BYTES} bytes.`,
        details: { maxBytes: String(MAX_ASSET_BYTES) },
      });
    }
    if (!(MIME_WHITELIST as readonly string[]).includes(input.mime)) {
      throw new BadRequestException({
        code: 'mime_not_allowed',
        message: 'Only JPEG, PNG, WebP, and AVIF are accepted.',
      });
    }
    const { portfolio } = await this.resolve(userId);
    const ext = extByMime(input.mime) ?? sanitizeExt(extname(input.filename));
    const key = `u/${userId}/p/${portfolio.id}/${createId()}.${ext}`;
    const signed = await this.r2.presignPut({ key, mime: input.mime, byteSize: input.byteSize });
    return { ...signed, maxBytes: MAX_ASSET_BYTES };
  }

  /**
   * Called by the client after a successful PUT. We HEAD the object to
   * confirm it actually landed and its size/mime match the whitelist,
   * then create the Asset row and enqueue the post-upload processor.
   */
  async confirm(userId: string, key: string): Promise<AssetSummary> {
    const { portfolio } = await this.resolve(userId);
    this.assertKeyBelongsToUser(key, userId, portfolio.id);

    const head = await this.r2.head(key);
    if (!head.exists) {
      throw new NotFoundException({
        code: 'upload_missing',
        message: 'The object was not found at R2. Retry the upload.',
      });
    }
    if (!(MIME_WHITELIST as readonly string[]).includes(head.mime)) {
      throw new BadRequestException({
        code: 'mime_mismatch',
        message: 'Uploaded file has an unsupported content type.',
      });
    }
    if (head.size > MAX_ASSET_BYTES) {
      throw new BadRequestException({
        code: 'asset_too_large',
        message: 'Uploaded file exceeds the 8 MiB limit.',
      });
    }

    const existing = await this.assets.findOne({ where: { key } });
    if (existing) return this.toSummary(existing);

    const asset = this.assets.create({
      portfolioId: portfolio.id,
      ownerId: userId,
      key,
      url: this.r2.publicUrl(key),
      mime: head.mime,
      byteSize: head.size,
      width: null,
      height: null,
      derivatives: [],
    });
    await this.assets.save(asset);
    await this.queue.enqueueProcess({ assetId: asset.id, key });
    this.events.emit('asset.uploaded', { assetId: asset.id });
    return this.toSummary(asset);
  }

  async list(userId: string): Promise<AssetSummary[]> {
    const { portfolio } = await this.resolve(userId);
    const rows = await this.assets.find({
      where: { portfolioId: portfolio.id, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => this.toSummary(r));
  }

  /**
   * Soft-deletes via DeleteDateColumn and enqueues a purge job that blasts
   * both the original key and its derivatives from R2. Idempotent: deleting
   * an already-deleted asset is a no-op.
   */
  async delete(userId: string, assetId: string): Promise<void> {
    const asset = await this.assets.findOne({ where: { id: assetId } });
    if (!asset || asset.ownerId !== userId) {
      throw new NotFoundException({ code: 'asset_not_found', message: 'Asset not found.' });
    }
    if (asset.deletedAt) return;

    asset.deletedAt = new Date();
    await this.assets.save(asset);

    const keys = [asset.key, ...asset.derivatives.map((d) => d.key)];
    await this.queue.enqueuePurge({ assetId: asset.id, keys });
    this.events.emit('asset.deleted', { assetId: asset.id });
  }

  private async resolve(userId: string): Promise<{ portfolio: Portfolio }> {
    const tenant = await this.tenants.findOne({ where: { ownerId: userId } });
    if (!tenant) {
      throw new NotFoundException({
        code: 'tenant_missing',
        message: 'Create a tenant first via GET /api/tenant.',
      });
    }
    const portfolio = await this.portfolios.findOne({ where: { tenantId: tenant.id } });
    if (!portfolio) {
      throw new NotFoundException({
        code: 'portfolio_missing',
        message: 'Create a portfolio first via GET /api/portfolio.',
      });
    }
    return { portfolio };
  }

  private assertKeyBelongsToUser(key: string, userId: string, portfolioId: string): void {
    const expectedPrefix = `u/${userId}/p/${portfolioId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new BadRequestException({
        code: 'key_not_owned',
        message: 'Key does not belong to the caller.',
      });
    }
  }

  private toSummary(a: Asset): AssetSummary {
    return {
      id: a.id,
      key: a.key,
      url: a.url,
      mime: a.mime,
      byteSize: a.byteSize,
      width: a.width,
      height: a.height,
      derivatives: a.derivatives,
      createdAt: a.createdAt.toISOString(),
    };
  }
}

function extByMime(mime: string): string | null {
  return (MIME_EXT as Record<string, string>)[mime] ?? null;
}

function sanitizeExt(raw: string): string {
  const stripped = raw.replace(/^\./, '').toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(stripped) ? stripped : 'bin';
}
