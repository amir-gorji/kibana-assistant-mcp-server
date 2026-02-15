/**
 * **kibana_search** — Read-only Elasticsearch DSL query execution.
 *
 * The core data retrieval tool. Accepts a full Elasticsearch DSL query body
 * and an optional time range expression. The time range is automatically
 * merged into whatever query shape is provided (bool, simple match, or empty).
 *
 * **For Business Managers:** Ask the agent a question like "show me failed
 * SWIFT payments in the last 24 hours" and the agent will use this tool to
 * construct and execute the appropriate DSL query.
 *
 * **For Developers:** Provides raw `_source` access with aggregation support.
 * Results are PII-redacted and size-capped server-side.
 *
 * @module
 */
import { z } from 'zod';
import { match } from 'dismatch';
import type { Model } from 'dismatch';
import { createSecureTool } from '../lib/toolWrapper';
import { validateReadOnlyQuery, validateIndexName } from '../lib/inputSanitizer';
import { ToolResult } from '../lib/types';

/**
 * Discriminated union classifying the shape of an incoming Elasticsearch
 * query body. Used by the time-range merger to decide how to inject the
 * `@timestamp` filter without overwriting existing query structure.
 */
type QueryShape =
  | Model<'has_bool', { bool: any; body: Record<string, any> }>
  | Model<'has_query', { query: any; body: Record<string, any> }>
  | Model<'no_query', { body: Record<string, any> }>;

/** Inspects a query body and returns the appropriate {@link QueryShape} variant. */
function classifyQuery(body: Record<string, any>): QueryShape {
  if (body.query?.bool) return { type: 'has_bool', bool: body.query.bool, body };
  if (body.query) return { type: 'has_query', query: body.query, body };
  return { type: 'no_query', body };
}

export const kibanaSearchTool = createSecureTool({
  id: 'kibana_search',
  description:
    'Execute a read-only DSL query against an Elasticsearch index to retrieve logs or data. ' +
    'Supports optional time_range filtering (e.g., "now-24h", "now-7d").',
  inputSchema: z.object({
    index: z.string().describe('The index pattern to search (e.g., "logs-*")'),
    query: z.record(z.any()).describe('The Elasticsearch DSL query object'),
    size: z
      .number()
      .optional()
      .default(10)
      .describe('Number of results to return (max capped by server config)'),
    time_range: z
      .string()
      .optional()
      .describe(
        'Optional time range filter, e.g. "now-24h", "now-7d". Adds a @timestamp range filter to the query.',
      ),
  }),
  execute: async ({ index, query, size, time_range }, { config, esClient }) => {
    validateIndexName(index);
    validateReadOnlyQuery(query);

    let searchBody = { ...query };

    // Wrap with time range filter if specified
    if (time_range) {
      const rangeFilter = {
        range: { '@timestamp': { gte: time_range, lte: 'now' } },
      };

      searchBody = match(classifyQuery(searchBody))({
        has_bool: ({ bool, body }) => ({
          ...body,
          query: {
            bool: {
              ...bool,
              filter: [
                ...(Array.isArray(bool.filter) ? bool.filter : bool.filter ? [bool.filter] : []),
                rangeFilter,
              ],
            },
          },
        }),
        has_query: ({ query, body }) => ({
          ...body,
          query: { bool: { must: [query], filter: [rangeFilter] } },
        }),
        no_query: ({ body }) => ({
          ...body,
          query: { bool: { filter: [rangeFilter] } },
        }),
      });
    }

    const data = await esClient.search(index, searchBody, size ?? 10);

    const result: ToolResult<any[]> = {
      type: 'success',
      data: data.hits.hits.map((hit: any) => hit._source),
      total: data.hits.total?.value ?? data.hits.total,
    };
    if (data.aggregations) {
      result.aggregations = data.aggregations;
    }
    return result;
  },
});
