import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogger, AuditEntry } from '../auditLogger';
import { ServerConfig } from '../config';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    kibanaUrl: 'http://localhost:5601',
    elasticsearchUrl: 'http://localhost:9200',
    kibanaApiKey: 'test-key',
    allowedIndexPatterns: [],
    maxSearchSize: 100,
    requestTimeoutMs: 30000,
    retryAttempts: 3,
    retryDelayMs: 1000,
    kibanaSpace: '',
    auditEnabled: true,
    piiRedactionEnabled: true,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: '2024-01-01T00:00:00.000Z',
    tool_called: 'test_tool',
    input_parameters: '{"key":"value"}',
    output_size_bytes: 100,
    redaction_count: 0,
    redacted_types: [],
    execution_time_ms: 50,
    status: 'success',
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  it('writes JSON to stderr when enabled', () => {
    const logger = new AuditLogger(makeConfig());
    const entry = makeEntry();
    logger.log(entry);

    expect(stderrSpy).toHaveBeenCalledOnce();
    const written = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.tool_called).toBe('test_tool');
    expect(parsed.status).toBe('success');
  });

  it('does not write when disabled', () => {
    const logger = new AuditLogger(makeConfig({ auditEnabled: false }));
    logger.log(makeEntry());
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('truncates large input parameters', () => {
    const logger = new AuditLogger(makeConfig());
    const longInput = 'x'.repeat(600);
    logger.log(makeEntry({ input_parameters: longInput }));

    const written = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.input_parameters.length).toBeLessThan(600);
    expect(parsed.input_parameters).toContain('...[truncated]');
  });
});
