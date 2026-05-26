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

export function lanUrls(port: number): string[] {
  return lanAddresses().map((ip) => `http://${ip}:${port}`);
}
