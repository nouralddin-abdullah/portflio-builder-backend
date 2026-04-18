import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/config.service';

export interface PresignedPut {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  key: string;
  expiresAt: Date;
}

export interface HeadResult {
  size: number;
  mime: string;
  exists: boolean;
}

/**
 * Thin R2 wrapper. R2 is S3-compatible so we use aws-sdk v3 pointed at the
 * account endpoint with region="auto". We only expose the ops we actually
 * need (pre-sign PUT, HEAD, DELETE) so we don't accidentally leak
 * ListBucket etc. into signed URLs.
 */
@Injectable()
export class R2Service implements OnModuleDestroy {
  private readonly logger = new Logger(R2Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly presignTtlSec: number;

  constructor(private readonly config: AppConfigService) {
    const { accountId, accessKeyId, secretAccessKey, bucket, endpoint, region, publicBaseUrl, presignTtlSec } =
      config.r2;
    this.bucket = bucket;
    this.publicBaseUrl = publicBaseUrl;
    this.presignTtlSec = presignTtlSec;
    const effectiveEndpoint = endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
    this.client = new S3Client({
      region,
      endpoint: effectiveEndpoint || undefined,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
      forcePathStyle: true,
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async presignPut(params: { key: string; mime: string; byteSize: number }): Promise<PresignedPut> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.mime,
      ContentLength: params.byteSize,
    } satisfies PutObjectCommandInput);
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.presignTtlSec });
    return {
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': params.mime },
      key: params.key,
      expiresAt: new Date(Date.now() + this.presignTtlSec * 1000),
    };
  }

  async head(key: string): Promise<HeadResult> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: Number(res.ContentLength ?? 0),
        mime: res.ContentType ?? 'application/octet-stream',
        exists: true,
      };
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
        ?.httpStatusCode;
      if (status === 404) return { size: 0, mime: '', exists: false };
      this.logger.error({ msg: 'r2_head_failed', key, err });
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Builds the public delivery URL (served via Cloudflare custom domain). */
  publicUrl(key: string): string {
    const base = this.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/${encodeURI(key)}`;
  }
}
