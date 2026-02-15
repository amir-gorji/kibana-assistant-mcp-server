import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mocks are available inside the vi.mock factory
const { mockCatIndices, mockGetMapping } = vi.hoisted(() => ({
  mockCatIndices: vi.fn(),
  mockGetMapping: vi.fn(),
}));

vi.mock('../../lib/toolWrapper', () => {
  return {
    config: {
      allowedIndexPatterns: [],
      piiRedactionEnabled: false,
      auditEnabled: false,
    },
    esClient: {
      catIndices: mockCatIndices,
      getMapping: mockGetMapping,
    },
    auditLogger: { log: vi.fn() },
    createSecureTool: (opts: any) => {
      // Return an object that exposes the execute function for testing
      return {
        id: opts.id,
        description: opts.description,
        execute: async (input: any) => {
          const config = {
            allowedIndexPatterns: [] as string[],
            ...((input as any).__testConfig ?? {}),
          };
          const esClient = { catIndices: mockCatIndices, getMapping: mockGetMapping };
          const defaults = { pattern: '*', include_hidden: false, max_indices: 50 };
          const merged = { ...defaults, ...input };
          return opts.execute(merged, { config, esClient });
        },
      };
    },
  };
});

// Import after mocking
import { discoverClusterTool } from '../discoverCluster';

describe('discover_cluster tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns indices with their field mappings', async () => {
    mockCatIndices.mockResolvedValue([
      { index: 'transactions', health: 'green', status: 'open', 'docs.count': '1000', 'store.size': '1mb' },
      { index: 'customers', health: 'green', status: 'open', 'docs.count': '500', 'store.size': '500kb' },
    ]);

    mockGetMapping.mockImplementation((index: string) => {
      if (index === 'transactions') {
        return Promise.resolve({
          transactions: {
            mappings: {
              properties: {
                amount: { type: 'double' },
                status: { type: 'keyword' },
              },
            },
          },
        });
      }
      return Promise.resolve({
        customers: {
          mappings: {
            properties: {
              name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            },
          },
        },
      });
    });

    const result = await (discoverClusterTool as any).execute({});

    expect(result.type).toBe('success');
    expect(result.data.cluster_summary.total_indices).toBe(2);
    expect(result.data.cluster_summary.discovered).toBe(2);
    expect(result.data.indices).toHaveLength(2);

    // Sorted by doc count desc — transactions (1000) first
    const txIndex = result.data.indices[0];
    expect(txIndex.index).toBe('transactions');
    expect(txIndex.fields).toEqual([
      { field: 'amount', type: 'double' },
      { field: 'status', type: 'keyword' },
    ]);

    const custIndex = result.data.indices[1];
    expect(custIndex.index).toBe('customers');
    // Should include multi-field .keyword
    expect(custIndex.fields).toEqual([
      { field: 'name', type: 'text' },
      { field: 'name.keyword', type: 'keyword' },
    ]);
  });

  it('filters hidden indices by default', async () => {
    mockCatIndices.mockResolvedValue([
      { index: '.kibana', health: 'green', status: 'open', 'docs.count': '100', 'store.size': '50kb' },
      { index: 'logs', health: 'green', status: 'open', 'docs.count': '2000', 'store.size': '5mb' },
    ]);

    mockGetMapping.mockResolvedValue({
      logs: { mappings: { properties: { message: { type: 'text' } } } },
    });

    const result = await (discoverClusterTool as any).execute({});

    expect(result.data.indices).toHaveLength(1);
    expect(result.data.indices[0].index).toBe('logs');
  });

  it('includes hidden indices when include_hidden is true', async () => {
    mockCatIndices.mockResolvedValue([
      { index: '.kibana', health: 'green', status: 'open', 'docs.count': '100', 'store.size': '50kb' },
      { index: 'logs', health: 'green', status: 'open', 'docs.count': '2000', 'store.size': '5mb' },
    ]);

    mockGetMapping.mockResolvedValue({
      whatever: { mappings: { properties: {} } },
    });

    const result = await (discoverClusterTool as any).execute({ include_hidden: true });

    expect(result.data.indices).toHaveLength(2);
  });

  it('caps indices to max_indices', async () => {
    const rawIndices = Array.from({ length: 10 }, (_, i) => ({
      index: `index-${i}`,
      health: 'green',
      status: 'open',
      'docs.count': String((10 - i) * 100),
      'store.size': '1mb',
    }));

    mockCatIndices.mockResolvedValue(rawIndices);
    mockGetMapping.mockResolvedValue({
      whatever: { mappings: { properties: { id: { type: 'keyword' } } } },
    });

    const result = await (discoverClusterTool as any).execute({ max_indices: 3 });

    expect(result.data.cluster_summary.total_indices).toBe(10);
    expect(result.data.cluster_summary.discovered).toBe(3);
    expect(result.data.indices).toHaveLength(3);
  });

  it('sorts indices by doc count descending', async () => {
    mockCatIndices.mockResolvedValue([
      { index: 'small', health: 'green', status: 'open', 'docs.count': '10', 'store.size': '1kb' },
      { index: 'large', health: 'green', status: 'open', 'docs.count': '10000', 'store.size': '10mb' },
      { index: 'medium', health: 'green', status: 'open', 'docs.count': '500', 'store.size': '1mb' },
    ]);

    mockGetMapping.mockResolvedValue({
      whatever: { mappings: { properties: {} } },
    });

    const result = await (discoverClusterTool as any).execute({});

    expect(result.data.indices.map((i: any) => i.index)).toEqual(['large', 'medium', 'small']);
  });

  it('handles mapping fetch failures gracefully', async () => {
    mockCatIndices.mockResolvedValue([
      { index: 'good', health: 'green', status: 'open', 'docs.count': '100', 'store.size': '1mb' },
      { index: 'bad', health: 'red', status: 'open', 'docs.count': '50', 'store.size': '500kb' },
    ]);

    mockGetMapping.mockImplementation((index: string) => {
      if (index === 'bad') return Promise.reject(new Error('Mapping unavailable'));
      return Promise.resolve({
        good: { mappings: { properties: { id: { type: 'keyword' } } } },
      });
    });

    const result = await (discoverClusterTool as any).execute({});

    expect(result.type).toBe('success');
    expect(result.data.indices).toHaveLength(2);

    const goodIdx = result.data.indices.find((i: any) => i.index === 'good');
    const badIdx = result.data.indices.find((i: any) => i.index === 'bad');
    expect(goodIdx.fields).toHaveLength(1);
    expect(badIdx.fields).toHaveLength(0);
  });

  it('deduplicates fields across concrete indices sharing the same mapping response', async () => {
    mockCatIndices.mockResolvedValue([
      { index: 'logs', health: 'green', status: 'open', 'docs.count': '500', 'store.size': '2mb' },
    ]);

    // ES can return multiple concrete indices for a single index (aliases)
    mockGetMapping.mockResolvedValue({
      'logs-000001': {
        mappings: { properties: { message: { type: 'text' } } },
      },
      'logs-000002': {
        mappings: { properties: { message: { type: 'text' } } },
      },
    });

    const result = await (discoverClusterTool as any).execute({});

    const logsIdx = result.data.indices[0];
    // Should be deduplicated — only one `message` field
    expect(logsIdx.fields).toEqual([{ field: 'message', type: 'text' }]);
  });
});
