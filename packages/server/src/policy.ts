/** Server delivery limits. Keep SDKs independent of the Collector runtime. */
export const SERVER_DELIVERY_POLICY = {
  maxBatchEvents: 20, maxBatchBytes: 16_384, maxReceiptBytes: 1024, maxTokenChars: 8185,
  maxAttempts: 3, defaultTimeoutMs: 5000, minTimeoutMs: 10, maxTimeoutMs: 30_000,
  defaultBudgetMs: 30_000, maxBudgetMs: 600_000, retryBaseMs: 1000, maxRetryHeaderChars: 128,
} as const;
