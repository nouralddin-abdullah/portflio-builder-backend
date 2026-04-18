import { Injectable, Logger } from '@nestjs/common';

export interface DohLookupResult {
  found: boolean;
  records: string[];
  error?: string;
}

interface DohJson {
  Status?: number;
  Answer?: Array<{ name?: string; type?: number; TTL?: number; data?: string }>;
  Comment?: string;
}

/**
 * DNS-over-HTTPS client (Cloudflare). Used for TXT lookups when verifying
 * custom domains. Pulled out of the service so it can be swapped or
 * spied-on in tests without network I/O.
 */
@Injectable()
export class DohService {
  private readonly logger = new Logger(DohService.name);
  private static readonly ENDPOINT = 'https://cloudflare-dns.com/dns-query';

  async lookupTxt(name: string): Promise<DohLookupResult> {
    const url = `${DohService.ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
      if (!res.ok) {
        return { found: false, records: [], error: `doh_http_${res.status}` };
      }
      const json = (await res.json()) as DohJson;
      if (json.Status !== 0) {
        return { found: false, records: [], error: `doh_status_${json.Status ?? 'unknown'}` };
      }
      const records = (json.Answer ?? [])
        .filter((a) => a.type === 16)
        .map((a) => stripQuotes(a.data ?? ''));
      return { found: records.length > 0, records };
    } catch (err) {
      this.logger.warn({ msg: 'doh_lookup_failed', name, err });
      return { found: false, records: [], error: 'doh_fetch_failed' };
    }
  }
}

/** TXT record values in DoH responses are returned as `"value"` — strip the wrapping quotes. */
function stripQuotes(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}
