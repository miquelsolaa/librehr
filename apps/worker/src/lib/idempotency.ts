export class IdempotencyManager {
  private processedKeys = new Set<string>();

  /**
   * Checks if an idempotency key has already been processed.
   * If not, marks it as processed and returns true.
   */
  async checkAndMark(key: string): Promise<boolean> {
    if (this.processedKeys.has(key)) {
      return false; // Already processed
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

export const defaultIdempotency = new IdempotencyManager();
