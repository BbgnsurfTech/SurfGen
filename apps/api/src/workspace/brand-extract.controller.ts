import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ValidationError } from '@surfgen/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequireOrgRole } from '../auth/guards';

const ExtractSchema = z.object({ url: z.string().min(3).max(300) });

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1_000_000;
const HEX_PATTERN = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

/** RFC1918/loopback/link-local/metadata ranges — SSRF guard for user URLs. */
function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  const octets = address.split('.').map(Number);
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function normalizeHex(hex: string): string {
  const value = hex.slice(1);
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return `#${full.toUpperCase()}`;
}

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
}

/**
 * Best-effort brand extraction from a public website: theme-color meta,
 * page title, and the most frequent CSS hex colors bucketed by luminance.
 * Everything returned stays editable in the brand builder.
 */
@ApiTags('brand-kits')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId/brand-kits', version: '1' })
export class BrandExtractController {
  @Post('extract')
  @RequireOrgRole('editor')
  async extract(
    @Param('orgId') _orgId: string,
    @Body(new ZodValidationPipe(ExtractSchema)) body: z.infer<typeof ExtractSchema>,
  ) {
    const url = new URL(/^https?:\/\//.test(body.url) ? body.url : `https://${body.url}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ValidationError('only http(s) URLs are supported');
    }
    const host = url.hostname;
    const resolved = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (resolved.length === 0 || resolved.some((entry) => isPrivateAddress(entry.address))) {
      throw new ValidationError('URL does not resolve to a public address');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let html: string;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'error', // a redirect could point back into the private network
        headers: { accept: 'text/html', 'user-agent': 'SurfGen-BrandExtract/1.0' },
      });
      if (!response.ok) throw new ValidationError(`site responded ${response.status}`);
      html = (await response.text()).slice(0, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError('could not fetch the site (blocked, redirected, or timed out)');
    } finally {
      clearTimeout(timer);
    }

    const counts = new Map<string, number>();
    for (const match of html.matchAll(HEX_PATTERN)) {
      const hex = normalizeHex(match[0]);
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
    const mids = ranked.filter((hex) => luminance(hex) > 40 && luminance(hex) < 190);
    const darks = ranked.filter((hex) => luminance(hex) <= 60);
    const lights = ranked.filter((hex) => luminance(hex) >= 230);

    const themeColor = /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,6})["']/i.exec(html)?.[1];
    const title =
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ??
      /<title[^>]*>([^<]{1,80})/i.exec(html)?.[1]?.trim();

    return {
      name: title ?? host,
      sourceUrl: host,
      colors: {
        primary: themeColor ? normalizeHex(themeColor) : (mids[0] ?? '#8B5E2F'),
        secondary: mids[1] ?? mids[0] ?? '#C49A6C',
        ink: darks[0] ?? '#1A1A1A',
        surface: lights[0] ?? '#FAF7F3',
      },
    };
  }
}
