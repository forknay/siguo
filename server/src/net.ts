import os from 'node:os';

/** Return all non-internal IPv4 addresses (one per active LAN interface). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

/** Public origin this server is reachable at, if it's being fronted by a tunnel
 *  or a real deployment. Set e.g. PUBLIC_URL=https://foo.trycloudflare.com.
 *  Trailing slashes are trimmed so callers can append paths safely. */
export function publicUrl(): string | null {
  const raw = process.env.PUBLIC_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

/** URLs the lobby advertises for joining. When PUBLIC_URL is set it comes
 *  first, since it's the only one that works off the local network. */
export function shareUrls(port: number): string[] {
  const lan = lanAddresses().map((ip) => `http://${ip}:${port}`);
  const pub = publicUrl();
  return pub ? [pub, ...lan] : lan;
}
