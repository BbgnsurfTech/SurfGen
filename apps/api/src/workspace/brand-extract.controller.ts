import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ValidationError } from '@surfgen/core';
import { safeFetch } from '@surfgen/safe-net';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequireOrgRole } from '../auth/guards';

const ExtractSchema = z.object({ url: z.string().min(3).max(300) });

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1_000_000;
const HEX_PATTERN = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

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
 * Outbound access goes through @surfgen/safe-net (SSRF-pinned, no
 * redirects, public unicast only). Everything returned stays editable in
 * the brand builder.
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
    const response = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
      headers: { accept: 'text/html', 'user-agent': 'SurfGen-BrandExtract/1.0' },
    });
    if (!response.ok) throw new ValidationError(`site responded ${response.status}`);
    const html = response.bodyText;

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
      name: title ?? url.hostname,
      sourceUrl: url.hostname,
      colors: {
        primary: themeColor ? normalizeHex(themeColor) : (mids[0] ?? '#8B5E2F'),
        secondary: mids[1] ?? mids[0] ?? '#C49A6C',
        ink: darks[0] ?? '#1A1A1A',
        surface: lights[0] ?? '#FAF7F3',
      },
    };
  }
}
