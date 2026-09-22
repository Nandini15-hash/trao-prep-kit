function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-host minimum gap between requests. Slots are reserved synchronously
 * (no `await` between reading and writing `nextAllowedAt`), so concurrent
 * callers targeting the same host can't both read the same "last request"
 * time and race past the limit.
 */
export class HostRateLimiter {
  private nextAllowedAt = new Map<string, number>();

  async wait(host: string, minGapMs: number): Promise<void> {
    if (minGapMs <= 0) return;
    const now = Date.now();
    const reservedAt = Math.max(now, this.nextAllowedAt.get(host) ?? 0);
    this.nextAllowedAt.set(host, reservedAt + minGapMs);
    const delay = reservedAt - now;
    if (delay > 0) await sleep(delay);
  }
}

export { sleep };
