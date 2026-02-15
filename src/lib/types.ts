/**
 * Core result types for the MCP tool pipeline.
 *
 * Every tool returns a {@link ToolResult} discriminated union. The `type` field
 * (`'success'` | `'error'`) is the discriminant, enabling exhaustive pattern
 * matching via dismatch's `match()`.
 *
 * @example
 * ```ts
 * const label = match(result)({
 *   success: ({ data }) => `Got ${data.length} hits`,
 *   error: ({ error }) => `Failed: ${error}`,
 * });
 * ```
 *
 * @module
 */
import type { Model } from 'dismatch';

/**
 * Successful tool execution. Contains the query payload plus optional
 * Elasticsearch metadata (hit count, aggregation buckets).
 *
 * @typeParam T - Shape of the `data` payload returned by the tool.
 */
export type ToolSuccess<T> = Model<'success', {
  /** The primary result payload. */
  data: T;
  /** Total hit count from Elasticsearch (when available). */
  total?: number;
  /** Raw Elasticsearch aggregation buckets (when the query includes aggs). */
  aggregations?: Record<string, any>;
}>;

/**
 * Failed tool execution. Carries a human-readable error message.
 * The `type` discriminant is `'error'`.
 */
export type ToolError = Model<'error', { error: string }>;

/**
 * Discriminated union returned by every MCP tool.
 *
 * Branch on the `type` field using dismatch `match()` for compile-time
 * exhaustiveness checking. Avoid `if/else` or `switch` — the type system
 * enforces that every variant is handled.
 *
 * @typeParam T - Shape of the `data` payload on the success variant.
 */
export type ToolResult<T> = ToolSuccess<T> | ToolError;
