/**
 * @deprecated Process-local only: it is empty after every restart and is not shared between
 * worker processes, so it guarantees nothing. Worse, it turns a pg-boss retry of a failed job
 * into a silent "skipped" success. Real deduplication is the `singletonKey` set by
 * `enqueue()` on `exclusive` queues (see lib/enqueue.ts).
 *
 * The only remaining caller is queues/audit.verify-chain.ts, which is being rewritten in a
 * separate workstream; delete this file once that lands.
 */
export class IdempotencyManager {
  private processedKeys = new Set<string>();

  async checkAndMark(key: string): Promise<boolean> {
    if (this.processedKeys.has(key)) {
      return false;
    }
    this.processedKeys.add(key);
    return true;
  }

  isProcessed(key: string): boolean {
    return this.processedKeys.has(key);
  }

  clear(): void {
    this.processedKeys.clear();
  }
}

/** @deprecated See IdempotencyManager. */
export const defaultIdempotency = new IdempotencyManager();
