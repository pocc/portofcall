/**
 * Protocol usage tracking.
 *
 * Stores per-protocol request counts in KV under the `usage:` prefix.
 * Reads and writes are best-effort — KV is not atomic, but the small
 * race window is acceptable for analytics counters.
 *
 * Keys: `usage:{protocol}` → stringified integer
 */

const USAGE_PREFIX = 'usage:';

/**
 * Increment the usage counter for a protocol.
 * Call this via ctx.waitUntil() to avoid blocking the response.
 */
export async function trackUsage(kv: KVNamespace, protocol: string): Promise<void> {
  const key = `${USAGE_PREFIX}${protocol.toLowerCase()}`;
  try {
    const current = await kv.get(key);
    const count = current !== null ? parseInt(current, 10) : 0;
    await kv.put(key, String(count + 1));
  } catch {
    // Best-effort — never let tracking errors surface to the user
  }
}

/**
 * Return all protocol usage counts, sorted descending by count.
 */
export async function getUsageStats(kv: KVNamespace): Promise<{ protocol: string; count: number }[]> {
  const result: { protocol: string; count: number }[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: USAGE_PREFIX, cursor });
    for (const key of page.keys) {
      const raw = await kv.get(key.name);
      const count = raw !== null ? parseInt(raw, 10) : 0;
      result.push({ protocol: key.name.slice(USAGE_PREFIX.length), count });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return result.sort((a, b) => b.count - a.count);
}
