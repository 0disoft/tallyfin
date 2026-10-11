type Audience = 'benchmark-admin' | 'benchmark-publisher';
type Sign = (audience: Audience, issuedAt: number, expiresAt: number) => Promise<string>;

/** Synthetic local authority only. Does not refresh or store real provider credentials. */
export function createBenchmarkTokens(sign: Sign, clock: () => number = Date.now) {
  const counts = { admin: 0, publisher: 0 };
  const now = () => {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value + 300000)) throw Error('invalid-benchmark-clock');
    return value;
  };
  const reader = (audience: Audience, name: keyof typeof counts) => {
    let cached: { token: string; expiresAtMs: number } | undefined;
    let pending: Promise<string> | undefined;
    return async () => {
      const at = now();
      if (cached && at < cached.expiresAtMs - 30000) return cached.token;
      if (pending) return pending;
      const issuedAt = Math.floor(at / 1000), expiresAt = issuedAt + 300;
      pending = (async () => {
        const token = await sign(audience, issuedAt, expiresAt);
        if (typeof token !== 'string' || !token || now() >= expiresAt * 1000) throw Error('invalid-benchmark-token');
        cached = { token, expiresAtMs: expiresAt * 1000 }; counts[name]++;
        return token;
      })();
      try { return await pending; } finally { pending = undefined; }
    };
  };
  return { getAdminToken: reader('benchmark-admin', 'admin'), getPublisherToken: reader('benchmark-publisher', 'publisher'),
    issuanceCounts: () => ({ ...counts }) };
}
