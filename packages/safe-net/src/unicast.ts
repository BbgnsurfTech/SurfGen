import ipaddr from 'ipaddr.js';

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
