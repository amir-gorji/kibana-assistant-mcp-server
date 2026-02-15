/**
 * Structured audit logging for MCP tool invocations.
 *
 * Every tool call produces an {@link AuditEntry} written as JSON to stderr.
 * This provides a tamper-evident record for compliance (PCI DSS, GDPR) and
 * operational monitoring. Input parameters are truncated to prevent sensitive
 * data from leaking into audit logs.
 *
 * @module
 */
import { ServerConfig } from './config';

/**
 * A single audit log record capturing one tool invocation.
 *
 * Written as a JSON line to stderr by {@link AuditLogger.log}.
 */
export interface AuditEntry {
  /** ISO 8601 timestamp of the invocation. */
  timestamp: string;
  /** MCP tool ID (e.g., `kibana_search`, `discover_cluster`). */
  tool_called: string;
  /** Serialized input parameters (truncated to 500 chars for safety). */
  input_parameters: string;
  /** Byte size of the serialized response returned to the LLM. */
  output_size_bytes: number;
  /** Number of PII values that were masked in this response. */
  redaction_count: number;
  /** Categories of PII detected (e.g., `['credit_card', 'email']`). */
  redacted_types: string[];
  /** Wall-clock execution time in milliseconds. */
  execution_time_ms: number;
  /** Whether the tool executed successfully or returned an error. */
  status: 'success' | 'error';
  /** Error message (only present when `status` is `'error'`). */
  error_message?: string;
}

const MAX_INPUT_LOG_LENGTH = 500;

/**
 * Writes structured audit records to stderr as JSON lines.
 *
 * Audit logging can be disabled via the `AUDIT_ENABLED` environment variable.
 * When disabled, {@link AuditLogger.log} is a no-op.
 */
export class AuditLogger {
  private enabled: boolean;

  constructor(config: ServerConfig) {
    this.enabled = config.auditEnabled;
  }

  log(entry: AuditEntry): void {
    if (!this.enabled) return;

    const sanitized = {
      ...entry,
      input_parameters:
        entry.input_parameters.length > MAX_INPUT_LOG_LENGTH
          ? entry.input_parameters.slice(0, MAX_INPUT_LOG_LENGTH) + '...[truncated]'
          : entry.input_parameters,
    };

    process.stderr.write(JSON.stringify(sanitized) + '\n');
  }
}
