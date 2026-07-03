import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import { ValidationError } from '@surfgen/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequireOrgRole } from '../auth/guards';

const ExtractSchema = z.object({ url: z.string().min(3).max(300) });

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1_000_000;
const HEX_PATTERN = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

/**
 * SSRF guard: only globally routable unicast addresses pass. ipaddr.js
 * classifies loopback/private/linkLocal/CGNAT/multicast/reserved/benchmark
 * ranges; IPv4-mapped and 6to4 IPv6 recurse on the embedded IPv4.
 */
export function isPublicUnicast(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isPublicUnicast(v6.toIPv4Address().toString());
    if (v6.range() === '6to4') return false;
  }
  return parsed.range() === 'unicast';
}

/**
 * Resolve once, verify every answer, then pin all sockets for this request to
 * the verified address — the actual connection can never follow a re-resolved
 * (rebound) DNS answer.
 */
async function resolvePinnedAddress(host: string): Promise<{ address: string; family: 4 | 6 }> {
  if (isIP(host)) {
    if (!isPublicUnicast(host)) throw new ValidationError('URL does not resolve to a public address');
    return { address: host, family: isIP(host) === 6 ? 6 : 4 };
  }
  const answers = await lookup(host, { all: true }).catch(() => []);
  if (answers.length === 0 || !answers.every((entry) => isPublicUnicast(entry.address))) {
    throw new ValidationError('URL does not resolve to a public address');
  }
  const first = answers[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

function pinnedAgent(pin: { address: string; family: 4 | 6 }): Agent {
  return new Agent({
    connect: {
      // net/tls lookup signature — always answer with the verified address.
      lookup: (_hostname, options, callback) => {
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (err: null, addrs: Array<{ address: string; family: number }>) => void)(null, [
            pin,
          ]);
        } else {
          callback(null, [pin] as never, pin.family as never);
        }
      },
    },
  });
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
    // Default ports only — no tunnelling to arbitrary services.
    if (url.port !== '' && url.port !== (url.protocol === 'https:' ? '443' : '80')) {
      throw new ValidationError('non-default ports are not allowed');
    }
    if (url.username || url.password) throw new ValidationError('credentials in URLs are not allowed');

    const pin = await resolvePinnedAddress(url.hostname);
    const agent = pinnedAgent(pin);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let html: string;
    try {
      const response = await undiciFetch(url, {
        signal: controller.signal,
        redirect: 'error', // a redirect could point back into the private network
        headers: { accept: 'text/html', 'user-agent': 'SurfGen-BrandExtract/1.0' },
        dispatcher: agent,
      });
      if (!response.ok) throw new ValidationError(`site responded ${response.status}`);
      html = (await response.text()).slice(0, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError('could not fetch the site (blocked, redirected, or timed out)');
    } finally {
      clearTimeout(timer);
      await agent.close().catch(() => undefined);
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
