/**
 * **check_cluster_health** — Elasticsearch cluster health tool.
 *
 * Returns the overall health status of the Elasticsearch cluster along with
 * shard and node counts. Useful for diagnosing degraded or red clusters before
 * running queries or investigating search performance issues.
 *
 * @module
 */
import { z } from 'zod';
import { createSecureTool } from '../lib/toolWrapper';

/** Summary of the Elasticsearch cluster health response. */
export interface ClusterHealthSummary {
  cluster_name: string;
  status: 'green' | 'yellow' | 'red';
  number_of_nodes: number;
  number_of_data_nodes: number;
  active_primary_shards: number;
  active_shards: number;
  unassigned_shards: number;
  timed_out: boolean;
  level: string;
  indices?: Record<string, any>;
}

export const checkClusterHealthTool = createSecureTool({
  id: 'check_cluster_health',
  description:
    'Check the health of the Elasticsearch cluster: returns overall status (green/yellow/red), node counts, shard counts, and unassigned shard information. Use this to diagnose cluster issues or verify platform health before investigating query problems.',
  mcp: {
    annotations: {
      title: 'Check Cluster Health',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  inputSchema: z.object({
    level: z
      .enum(['cluster', 'indices', 'shards'])
      .optional()
      .default('cluster')
      .describe(
        'Granularity of health information. "cluster" returns overall status only. "indices" includes per-index health. "shards" includes per-shard health. Defaults to "cluster".',
      ),
  }),
  execute: async ({ level }, { esClient }) => {
    const raw = await esClient.clusterHealth(level);

    const summary: ClusterHealthSummary = {
      cluster_name: raw.cluster_name,
      status: raw.status,
      number_of_nodes: raw.number_of_nodes,
      number_of_data_nodes: raw.number_of_data_nodes,
      active_primary_shards: raw.active_primary_shards,
      active_shards: raw.active_shards,
      unassigned_shards: raw.unassigned_shards,
      timed_out: raw.timed_out,
      level,
      ...(raw.indices ? { indices: raw.indices } : {}),
    };

    return {
      type: 'success' as const,
      data: summary satisfies ClusterHealthSummary,
    };
  },
});
