/**
 * HTTP client for Elasticsearch and Kibana APIs.
 *
 * Manages two separate Axios instances — one for direct Elasticsearch access
 * (searches, mappings, cat APIs) and one for the Kibana API (saved objects,
 * spaces). Both share the same API key and respect the configured timeout.
 *
 * All requests are wrapped in {@link ElasticsearchClient.withRetry | withRetry},
 * which applies exponential backoff on transient failures (HTTP 429, 503,
 * and network errors). Client errors (4xx except 429) are not retried.
 *
 * @module
 */
import axios, { AxiosInstance } from 'axios';
import { ServerConfig } from './config';
import { validateIndexName } from './inputSanitizer';

/**
 * Authenticated HTTP client for Elasticsearch and Kibana.
 *
 * Enforces index access control via {@link ServerConfig.allowedIndexPatterns}
 * and provides automatic retry with exponential backoff for transient failures.
 */
export class ElasticsearchClient {
  private esHttp: AxiosInstance;
  private kibanaHttp: AxiosInstance;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;

    this.esHttp = axios.create({
      baseURL: config.elasticsearchUrl,
      timeout: config.requestTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${config.kibanaApiKey}`,
      },
    });

    const kibanaBaseURL = config.kibanaSpace
      ? `${config.kibanaUrl}/s/${config.kibanaSpace}`
      : config.kibanaUrl;

    this.kibanaHttp = axios.create({
      baseURL: kibanaBaseURL,
      timeout: config.requestTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${config.kibanaApiKey}`,
        'kbn-xsrf': 'true',
      },
    });
  }

  /**
   * Validates that an index name is well-formed and allowed by the server's
   * access control patterns.
   *
   * @throws {Error} If the index name contains invalid characters or is not
   *   covered by {@link ServerConfig.allowedIndexPatterns}.
   */
  validateIndex(index: string): void {
    validateIndexName(index);

    if (this.config.allowedIndexPatterns.length > 0) {
      const allowed = this.config.allowedIndexPatterns.some((pattern) =>
        globMatch(pattern, index),
      );
      if (!allowed) {
        throw new Error(
          `Index "${index}" is not in the allowed index patterns: ${this.config.allowedIndexPatterns.join(', ')}`,
        );
      }
    }
  }

  /**
   * Executes a read-only search against Elasticsearch.
   *
   * The `size` parameter is capped at {@link ServerConfig.maxSearchSize} to
   * protect LLM token budgets and cluster resources.
   *
   * @param index - Index pattern to search (e.g., `transactions-*`).
   * @param body - Elasticsearch DSL query body.
   * @param size - Requested number of hits (will be capped server-side).
   * @returns Raw Elasticsearch search response (`hits`, `aggregations`, etc.).
   */
  async search(
    index: string,
    body: Record<string, any>,
    size: number,
  ): Promise<any> {
    this.validateIndex(index);
    const cappedSize = Math.min(size, this.config.maxSearchSize);
    return this.withRetry(async () => {
      const response = await this.esHttp.post(`/${index}/_search`, {
        ...body,
        size: cappedSize,
      });
      return response.data;
    });
  }

  /**
   * Lists indices via the `_cat/indices` API.
   *
   * @param pattern - Index glob pattern (default `*`).
   * @returns Array of index metadata objects (index, health, status, docs.count, store.size).
   */
  async catIndices(pattern: string = '*'): Promise<any[]> {
    return this.withRetry(async () => {
      const response = await this.esHttp.get(
        `/_cat/indices/${pattern}?format=json&h=index,health,status,docs.count,store.size`,
      );
      return response.data;
    });
  }

  /**
   * Retrieves field mappings for an index.
   *
   * @param index - Index name or pattern.
   * @returns Raw Elasticsearch mapping response keyed by concrete index name.
   */
  async getMapping(index: string): Promise<any> {
    this.validateIndex(index);
    return this.withRetry(async () => {
      const response = await this.esHttp.get(`/${index}/_mapping`);
      return response.data;
    });
  }

  async kibanaGet(path: string): Promise<any> {
    return this.withRetry(async () => {
      const response = await this.kibanaHttp.get(path);
      return response.data;
    });
  }

  async kibanaPost(path: string, body: Record<string, any>): Promise<any> {
    return this.withRetry(async () => {
      const response = await this.kibanaHttp.post(path, body);
      return response.data;
    });
  }

  async clusterHealth(level: 'cluster' | 'indices' | 'shards' = 'cluster'): Promise<any> {
    return this.withRetry(async () => {
      const response = await this.esHttp.get(`/_cluster/health?level=${level}`);
      return response.data;
    });
  }

  async findAlertingRules(params: Record<string, string | number>): Promise<any> {
    return this.withRetry(async () => {
      const query = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString();
      const path = `/api/alerting/rules/_find${query ? `?${query}` : ''}`;
      const response = await this.kibanaHttp.get(path);
      return response.data;
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;

        // Don't retry on client errors (except 429)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }

        // Only retry on 429, 503, or network errors
        if (attempt < this.config.retryAttempts - 1) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}

function globMatch(pattern: string, value: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(value);
}
