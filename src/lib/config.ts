/**
 * Server configuration loaded from environment variables.
 *
 * Required variables: `KIBANA_URL`, `KIBANA_API_KEY`.
 * All other settings have sensible defaults for development.
 *
 * @see {@link loadConfig} for the loader that populates this interface.
 */
export interface ServerConfig {
  /** Base URL of the Kibana deployment (e.g., `https://xyz.kb.us-east-1.aws.found.io`). */
  kibanaUrl: string;
  /** Elasticsearch URL, derived from {@link kibanaUrl} by replacing `.kb.` with `.es.`. */
  elasticsearchUrl: string;
  /** Base64-encoded API key for authenticating with Kibana/Elasticsearch. */
  kibanaApiKey: string;
  /** Glob patterns restricting which indices the agent may access. Empty = unrestricted. */
  allowedIndexPatterns: string[];
  /** Hard cap on documents returned per search (1--500). Protects token budgets. */
  maxSearchSize: number;
  /** HTTP request timeout in milliseconds. */
  requestTimeoutMs: number;
  /** Number of retry attempts for transient failures (429, 503, network errors). */
  retryAttempts: number;
  /** Base delay in ms for exponential backoff between retries. */
  retryDelayMs: number;
  /** Kibana space slug (empty string = default space). */
  kibanaSpace: string;
  /** Whether to emit structured audit log entries to stderr. */
  auditEnabled: boolean;
  /** Whether to scan and mask PII (credit cards, IBANs, SSNs, etc.) in tool responses. */
  piiRedactionEnabled: boolean;
}

/** @throws {Error} If the environment variable is not set. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Loads server configuration from environment variables.
 *
 * The Elasticsearch URL is derived from the Kibana URL by replacing `.kb.`
 * with `.es.` in the hostname — this matches the Elastic Cloud URL convention.
 *
 * @throws {Error} If required variables (`KIBANA_URL`, `KIBANA_API_KEY`) are missing.
 */
export function loadConfig(): ServerConfig {
  const kibanaUrl = requiredEnv('KIBANA_URL');
  const elasticsearchUrl = kibanaUrl.replace(/\.kb\./, '.es.');

  const maxSearchSizeRaw = parseInt(process.env.MAX_SEARCH_SIZE || '100', 10);
  const maxSearchSize = Math.min(Math.max(1, maxSearchSizeRaw), 500);

  return {
    kibanaUrl,
    elasticsearchUrl,
    kibanaApiKey: requiredEnv('KIBANA_API_KEY'),
    allowedIndexPatterns: process.env.ALLOWED_INDEX_PATTERNS
      ? process.env.ALLOWED_INDEX_PATTERNS.split(',').map((p) => p.trim()).filter(Boolean)
      : [],
    maxSearchSize,
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3', 10),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000', 10),
    kibanaSpace: process.env.KIBANA_SPACE || '',
    auditEnabled: process.env.AUDIT_ENABLED !== 'false',
    piiRedactionEnabled: process.env.PII_REDACTION_ENABLED !== 'false',
  };
}
