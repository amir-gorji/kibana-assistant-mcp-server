import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClusterHealth } = vi.hoisted(() => ({
  mockClusterHealth: vi.fn(),
}));

vi.mock('../../lib/toolWrapper', () => {
  return {
    config: {
      allowedIndexPatterns: [],
      piiRedactionEnabled: false,
      auditEnabled: false,
    },
    esClient: {
      clusterHealth: mockClusterHealth,
    },
    auditLogger: { log: vi.fn() },
    createSecureTool: (opts: any) => {
      return {
        id: opts.id,
        description: opts.description,
        execute: async (input: any) => {
          const config = { allowedIndexPatterns: [] as string[] };
          const esClient = { clusterHealth: mockClusterHealth };
          const defaults = { level: 'cluster' as const };
          const merged = { ...defaults, ...input };
          return opts.execute(merged, { config, esClient });
        },
      };
    },
  };
});

// Import after mocking
import { checkClusterHealthTool } from '../checkClusterHealth';

const baseHealthResponse = {
  cluster_name: 'my-cluster',
  status: 'green',
  number_of_nodes: 3,
  number_of_data_nodes: 3,
  active_primary_shards: 10,
  active_shards: 20,
  unassigned_shards: 0,
  timed_out: false,
};

describe('check_cluster_health tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct shape at default cluster level — no indices key', async () => {
    mockClusterHealth.mockResolvedValue(baseHealthResponse);

    const result = await (checkClusterHealthTool as any).execute({});

    expect(result.type).toBe('success');
    expect(result.data).toEqual({
      cluster_name: 'my-cluster',
      status: 'green',
      number_of_nodes: 3,
      number_of_data_nodes: 3,
      active_primary_shards: 10,
      active_shards: 20,
      unassigned_shards: 0,
      timed_out: false,
      level: 'cluster',
    });
    expect(result.data.indices).toBeUndefined();
  });

  it('includes indices map when level = "indices"', async () => {
    mockClusterHealth.mockResolvedValue({
      ...baseHealthResponse,
      indices: {
        'transactions-000001': { status: 'green', number_of_shards: 1, number_of_replicas: 1 },
      },
    });

    const result = await (checkClusterHealthTool as any).execute({ level: 'indices' });

    expect(result.type).toBe('success');
    expect(result.data.level).toBe('indices');
    expect(result.data.indices).toBeDefined();
    expect(result.data.indices['transactions-000001']).toMatchObject({ status: 'green' });
  });

  it('passes level argument through to esClient.clusterHealth()', async () => {
    mockClusterHealth.mockResolvedValue(baseHealthResponse);

    await (checkClusterHealthTool as any).execute({ level: 'shards' });

    expect(mockClusterHealth).toHaveBeenCalledWith('shards');
  });

  it('propagates non-HTTP errors (re-throws for toolWrapper)', async () => {
    mockClusterHealth.mockRejectedValue(new Error('Network timeout'));

    await expect((checkClusterHealthTool as any).execute({})).rejects.toThrow('Network timeout');
  });
});
