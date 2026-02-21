/**
 * **list_indices** — Lists available Elasticsearch indices.
 *
 * A lightweight discovery tool that returns index names, health status, doc
 * counts, and store sizes. Useful for getting a quick overview of the cluster
 * before drilling into specific indices with {@link discoverClusterTool} or
 * {@link getIndexMappingsTool}.
 *
 * Hidden/system indices (those starting with `.`) are excluded by default.
 * Access is filtered against {@link ServerConfig.allowedIndexPatterns} when configured.
 *
 * @module
 */
import { z } from 'zod';
import { createSecureTool } from '../lib/toolWrapper';
import { validateIndexName } from '../lib/inputSanitizer';

/** Summary metadata for a single Elasticsearch index. */
export interface IndexInfo {
  index: string;
  health: string;
  status: string;
  doc_count: string;
  store_size: string;
}

export const listIndicesTool = createSecureTool({
  id: 'list_indices',
  description:
    'List available Elasticsearch indices. Returns index names, health, status, doc count, and store size.',
  mcp: {
    annotations: {
      title: 'List Indices',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  inputSchema: z.object({
    pattern: z
      .string()
      .optional()
      .default('*')
      .describe('Index pattern to filter (e.g., "logs-*"). Defaults to "*".'),
    include_hidden: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include system/hidden indices (those starting with "."). Defaults to false.'),
  }),
  execute: async ({ pattern, include_hidden }, { config, esClient }) => {
    validateIndexName(pattern ?? '*');

    const rawIndices = await esClient.catIndices(pattern);

    let indices: IndexInfo[] = rawIndices.map((idx: any) => ({
      index: idx.index,
      health: idx.health,
      status: idx.status,
      doc_count: idx['docs.count'],
      store_size: idx['store.size'],
    }));

    // Filter hidden indices
    if (!include_hidden) {
      indices = indices.filter((idx) => !idx.index.startsWith('.'));
    }

    // Filter against allowed patterns if configured
    if (config.allowedIndexPatterns.length > 0) {
      indices = indices.filter((idx) =>
        config.allowedIndexPatterns.some((p) => globMatch(p, idx.index)),
      );
    }

    return {
      type: 'success' as const,
      data: indices,
      total: indices.length,
    };
  },
});

function globMatch(pattern: string, value: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(value);
}
