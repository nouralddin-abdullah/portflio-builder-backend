import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { Asset, type AssetDerivative } from '../../database/entities/asset.entity';
import { REDIS_BULLMQ } from '../../common/redis/redis.module';
import { AppConfigService } from '../../config/config.service';
import { R2Service } from './r2.service';
import {
  ASSETS_PROCESS_QUEUE,
  ASSETS_PURGE_QUEUE,
  type AssetProcessJob,
  type AssetPurgeJob,
} from './assets.queue';

const DERIVATIVE_WIDTHS = [1600, 800] as const;

/**
 * In-process BullMQ worker for asset post-upload handling. Boots only when
 * the runtime is not marked 'test'; prod deployments should run a dedicated
 * worker service and disable the in-process worker via config flag.
 */
@Injectable()
export class AssetsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssetsProcessor.name);
  private processWorker?: Worker<AssetProcessJob>;
  private purgeWorker?: Worker<AssetPurgeJob>;
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @Inject(REDIS_BULLMQ) private readonly redis: Redis,
    private readonly r2: R2Service,
    private readonly config: AppConfigService,
  ) {
    const { accountId, accessKeyId, secretAccessKey, bucket, endpoint, region } = config.r2;
    this.bucket = bucket;
    const effectiveEndpoint = endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
    this.s3 = new S3Client({
      region,
      endpoint: effectiveEndpoint || undefined,
      credentials:
        accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
      forcePathStyle: true,
    });
  }

  onModuleInit(): void {
    if (this.config.isTest) return;
    this.processWorker = new Worker<AssetProcessJob>(
      ASSETS_PROCESS_QUEUE,
      (job) => this.handleProcess(job),
      { connection: this.redis, concurrency: 3, prefix: 'portfilo' },
    );
    this.purgeWorker = new Worker<AssetPurgeJob>(
      ASSETS_PURGE_QUEUE,
      (job) => this.handlePurge(job),
      { connection: this.redis, concurrency: 5, prefix: 'portfilo' },
    );
    for (const worker of [this.processWorker, this.purgeWorker]) {
      worker.on('failed', (job, err) => {
        this.logger.error({ msg: 'job_failed', queue: worker.name, jobId: job?.id, err });
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.processWorker?.close(), this.purgeWorker?.close()]);
    this.s3.destroy();
  }

  /**
   * Strips EXIF and emits 800/1600 width webp derivatives alongside the
   * original. Each derivative is uploaded as `<key>@<w>.webp`. The source
   * key is kept as the canonical public asset.
   */
  async handleProcess(job: Job<AssetProcessJob>): Promise<void> {
    const { assetId, key } = job.data;
    const asset = await this.assets.findOne({ where: { id: assetId } });
    if (!asset) {
      this.logger.warn({ msg: 'asset_process_missing', assetId });
      return;
    }
    const original = await this.downloadBytes(key);
    const stripped = await sharp(original).rotate().withMetadata({ exif: {} }).toBuffer();
    const meta = await sharp(stripped).metadata();

    const derivatives: AssetDerivative[] = [];
    for (const width of DERIVATIVE_WIDTHS) {
      const buffer = await sharp(stripped).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      const derivKey = `${key}@${width}.webp`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: derivKey,
          Body: buffer,
          ContentType: 'image/webp',
        }),
      );
      derivatives.push({ width, url: this.r2.publicUrl(derivKey), key: derivKey });
    }

    asset.width = meta.width ?? null;
    asset.height = meta.height ?? null;
    asset.derivatives = derivatives;
    await this.assets.save(asset);
  }

  async handlePurge(job: Job<AssetPurgeJob>): Promise<void> {
    const { keys } = job.data;
    for (const key of keys) {
      try {
        await this.r2.delete(key);
      } catch (err) {
        this.logger.warn({ msg: 'purge_key_failed', key, err });
      }
    }
  }

  private async downloadBytes(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = res.Body;
    if (!stream) throw new Error('empty response body');
    return streamToBuffer(stream as NodeJS.ReadableStream);
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
