import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindAlertingRules } = vi.hoisted(() => ({
  mockFindAlertingRules: vi.fn(),
}));

vi.mock('../../lib/toolWrapper', () => {
  return {
    config: {
      allowedIndexPatterns: [],
      piiRedactionEnabled: false,
      auditEnabled: false,
    },
    esClient: {
      findAlertingRules: mockFindAlertingRules,
    },
    auditLogger: { log: vi.fn() },
    createSecureTool: (opts: any) => {
      return {
        id: opts.id,
        description: opts.description,
        execute: async (input: any) => {
          const config = { allowedIndexPatterns: [] as string[] };
          const esClient = { findAlertingRules: mockFindAlertingRules };
          const defaults = { max_results: 20 };
          const merged = { ...defaults, ...input };
          return opts.execute(merged, { config, esClient });
        },
      };
    },
  };
});

// Import after mocking
import { getAlertStatusTool } from '../getAlertStatus';

const makeRule = (overrides: Record<string, any> = {}) => ({
  id: 'rule-1',
  name: 'High Error Rate',
  rule_type_id: 'apm.error_rate',
  enabled: true,
  tags: ['critical'],
  schedule: { interval: '5m' },
  execution_status: {
    status: 'active',
    last_execution_date: '2024-01-15T10:00:00Z',
    error: undefined,
  },
  ...overrides,
});

describe('get_alert_status tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns normalized AlertRule list from raw Kibana response', async () => {
    mockFindAlertingRules.mockResolvedValue({
      total: 1,
      data: [makeRule()],
    });

    const result = await (getAlertStatusTool as any).execute({});

    expect(result.type).toBe('success');
    expect(result.data.total).toBe(1);
    expect(result.data.returned).toBe(1);
    expect(result.data.rules).toHaveLength(1);

    const rule = result.data.rules[0];
    expect(rule.id).toBe('rule-1');
    expect(rule.name).toBe('High Error Rate');
    expect(rule.rule_type_id).toBe('apm.error_rate');
    expect(rule.enabled).toBe(true);
    expect(rule.tags).toEqual(['critical']);
    expect(rule.last_execution_status).toBe('active');
    expect(rule.last_execution_date).toBe('2024-01-15T10:00:00Z');
  });

  it('passes per_page from max_results to findAlertingRules', async () => {
    mockFindAlertingRules.mockResolvedValue({ total: 0, data: [] });

    await (getAlertStatusTool as any).execute({ max_results: 5 });

    expect(mockFindAlertingRules).toHaveBeenCalledWith(
      expect.objectContaining({ per_page: 5 }),
    );
  });

  it('builds correct KQL filter from rule_type + severity', async () => {
    mockFindAlertingRules.mockResolvedValue({ total: 0, data: [] });

    await (getAlertStatusTool as any).execute({
      rule_type: '.es-query',
      severity: 'critical',
    });

    expect(mockFindAlertingRules).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: 'rule_type_id: ".es-query" AND tags: "critical"',
      }),
    );
  });

  it('builds filter with only rule_type when severity is absent', async () => {
    mockFindAlertingRules.mockResolvedValue({ total: 0, data: [] });

    await (getAlertStatusTool as any).execute({ rule_type: '.es-query' });

    expect(mockFindAlertingRules).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'rule_type_id: ".es-query"' }),
    );
  });

  it('filters by status client-side after API call', async () => {
    mockFindAlertingRules.mockResolvedValue({
      total: 3,
      data: [
        makeRule({ id: 'r1', execution_status: { status: 'active', last_execution_date: undefined } }),
        makeRule({ id: 'r2', execution_status: { status: 'ok', last_execution_date: undefined } }),
        makeRule({ id: 'r3', execution_status: { status: 'error', last_execution_date: undefined } }),
      ],
    });

    const result = await (getAlertStatusTool as any).execute({ status: 'error' });

    expect(result.type).toBe('success');
    expect(result.data.rules).toHaveLength(1);
    expect(result.data.rules[0].id).toBe('r3');
  });

  it('returns ToolResult error (not a throw) on 404 — Alerting not available', async () => {
    const err = Object.assign(new Error('Not Found'), {
      response: { status: 404 },
    });
    mockFindAlertingRules.mockRejectedValue(err);

    const result = await (getAlertStatusTool as any).execute({});

    expect(result.type).toBe('error');
    expect(result.error).toMatch(/Kibana Alerting is not available/);
  });

  it('returns ToolResult error (not a throw) on 403 — missing privileges', async () => {
    const err = Object.assign(new Error('Forbidden'), {
      response: { status: 403 },
    });
    mockFindAlertingRules.mockRejectedValue(err);

    const result = await (getAlertStatusTool as any).execute({});

    expect(result.type).toBe('error');
    expect(result.error).toMatch(/Kibana Alerting is not available/);
  });

  it('re-throws non-404/403 errors for toolWrapper to handle generically', async () => {
    const err = Object.assign(new Error('Internal Server Error'), {
      response: { status: 500 },
    });
    mockFindAlertingRules.mockRejectedValue(err);

    await expect((getAlertStatusTool as any).execute({})).rejects.toThrow('Internal Server Error');
  });
});
