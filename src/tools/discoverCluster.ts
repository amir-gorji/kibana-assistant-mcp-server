/**
 * **discover_cluster** — Cluster discovery tool.
 *
 * This is the entry point for any LLM session. The agent should call this
 * tool first to understand what indices exist, how large they are, and what
 * fields each contains. Armed with this context, the agent can construct
 * accurate DSL queries without hallucinating field names.
 *
 * **Business value:** Eliminates the need for stakeholders to memorize index
 * names or field schemas. A Business Manager can say "show me payment data"
 * and the agent will discover that `transactions-*` exists with fields like
 * `amount`, `currency`, and `status`.
 *
 * @module
 */
import { z } from 'zod';
import { match } from 'dismatch';
import type { Model } from 'dismatch';
import { createSecureTool } from '../lib/toolWrapper';
import { validateIndexName } from '../lib/inputSanitizer';
import { flattenProperties, FieldMapping } from '../lib/mappingUtils';

/** Metadata for a single discovered index, including its field mappings. */
export interface DiscoveredIndex {
  index: string;
  health: string;
  status: string;
  doc_count: string;
  store_size: string;
  fields: FieldMapping[];
}

/** Top-level response shape for cluster discovery. */
export interface ClusterDiscovery {
  cluster_summary: { total_indices: number; discovered: number };
  indices: DiscoveredIndex[];
}

/**
 * Discriminated union representing the outcome of fetching an index's mappings.
 * Uses dismatch `match()` to branch on success vs failure without try/catch.
 */
type MappingFetch =
  | Model<'fetched', { fields: FieldMapping[] }>
  | Model<'failed', {}>;

/** Removes duplicate field paths that can appear when an alias resolves to multiple concrete indices. */
function deduplicateFields(fields: FieldMapping[]): FieldMapping[] {
  const seen = new Map<string, string>();
  for (const f of fields) {
    if (!seen.has(f.field)) {
      seen.set(f.field, f.type);
    }
  }
  return Array.from(seen.entries()).map(([field, type]) => ({ field, type }));
}

export const discoverClusterTool = createSecureTool({
  id: 'discover_cluster',
  description:
    'Discover the Elasticsearch cluster: lists all available indices and their field mappings. Call this tool FIRST before any search to understand what data is available, what indices exist, and what fields each index contains.',
  mcp: {
    annotations: {
      title: 'Discover Cluster',
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
    max_indices: z
      .number()
      .optional()
      .default(50)
      .describe('Maximum number of indices to fetch mappings for. Defaults to 50.'),
  }),
  execute: async ({ pattern, include_hidden, max_indices }, { config, esClient }) => {
    validateIndexName(pattern ?? '*');

    // 1. List all indices
    const rawIndices = await esClient.catIndices(pattern);

    // 2. Build index info list
    let indices = rawIndices.map((idx: any) => ({
      index: idx.index as string,
      health: idx.health as string,
      status: idx.status as string,
      doc_count: idx['docs.count'] as string,
      store_size: idx['store.size'] as string,
    }));

    // 3. Filter hidden indices
    if (!include_hidden) {
      indices = indices.filter((idx) => !idx.index.startsWith('.'));
    }

    // 4. Filter against allowed patterns if configured
    if (config.allowedIndexPatterns.length > 0) {
      indices = indices.filter((idx) =>
        config.allowedIndexPatterns.some((p) => globMatch(p, idx.index)),
      );
    }

    const totalIndices = indices.length;

    // 5. Sort by doc count descending (biggest first) and cap
    indices.sort((a, b) => {
      const countA = parseInt(a.doc_count, 10) || 0;
      const countB = parseInt(b.doc_count, 10) || 0;
      return countB - countA;
    });
    indices = indices.slice(0, max_indices);

    // 6. Fetch mappings in parallel
    const discoveredIndices: DiscoveredIndex[] = await Promise.all(
      indices.map(async (idx) => {
        const mappingResult: MappingFetch = await esClient.getMapping(idx.index)
          .then((data: any) => {
            const fields: FieldMapping[] = [];
            for (const indexName of Object.keys(data)) {
              const properties = data[indexName]?.mappings?.properties;
              if (properties) flattenProperties(properties, '', fields);
            }
            return { type: 'fetched' as const, fields };
          })
          .catch(() => ({ type: 'failed' as const }));

        const fields = match(mappingResult)({
          fetched: ({ fields }) => deduplicateFields(fields),
          failed: () => [],
        });

        return { ...idx, fields };
      }),
    );

    return {
      type: 'success' as const,
      data: {
        cluster_summary: {
          total_indices: totalIndices,
          discovered: discoveredIndices.length,
        },
        indices: discoveredIndices,
      } satisfies ClusterDiscovery,
    };
  },
});

function globMatch(pattern: string, value: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(value);
}
