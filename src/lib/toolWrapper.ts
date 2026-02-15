/**
 * Secure tool wrapper that forms the core execution pipeline for every MCP tool.
 *
 * The pipeline enforces a strict sequence for every invocation:
 * 1. Execute the tool's business logic
 * 2. Redact PII from successful responses (credit cards, IBANs, SSNs, emails, phones)
 * 3. Write a structured audit log entry to stderr
 * 4. Return the (potentially redacted) result to the LLM
 *
 * All tools are created via {@link createSecureTool} so they inherit this
 * pipeline automatically. Individual tool implementations only need to provide
 * the business logic — security concerns are handled here.
 *
 * @module
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { match } from 'dismatch';
import { loadConfig, ServerConfig } from './config';
import { ElasticsearchClient } from './esClient';
import { AuditLogger } from './auditLogger';
import { redactPII } from './piiRedaction';
import { ToolResult } from './types';

/** Shared server configuration singleton. Initialized once on first import. */
export const config: ServerConfig = loadConfig();

/** Shared Elasticsearch/Kibana HTTP client singleton. */
export const esClient = new ElasticsearchClient(config);

/** Shared audit logger singleton. */
export const auditLogger = new AuditLogger(config);

/**
 * Options for defining a secure MCP tool.
 *
 * @typeParam TInput - Zod schema type for the tool's input parameters.
 * @typeParam TOutput - Shape of the `data` payload on a successful result.
 */
interface SecureToolOptions<TInput extends z.ZodType, TOutput> {
  id: string;
  description: string;
  inputSchema: TInput;
  execute: (
    input: z.infer<TInput>,
    context: { config: ServerConfig; esClient: ElasticsearchClient },
  ) => Promise<ToolResult<TOutput>>;
}

/**
 * Creates an MCP tool wrapped in the secure execution pipeline.
 *
 * The wrapper handles error catching, PII redaction, and audit logging
 * so that individual tool implementations can focus purely on business logic.
 * All branching on the {@link ToolResult} discriminated union uses dismatch
 * `match()` for exhaustive, type-safe pattern matching.
 *
 * @typeParam TInput - Zod schema type for the tool's input parameters.
 * @typeParam TOutput - Shape of the `data` payload on a successful result.
 *
 * @example
 * ```ts
 * export const myTool = createSecureTool({
 *   id: 'my_tool',
 *   description: 'Does something useful',
 *   inputSchema: z.object({ query: z.string() }),
 *   execute: async ({ query }, { esClient }) => {
 *     const data = await esClient.search('logs-*', { query }, 10);
 *     return { type: 'success', data: data.hits.hits };
 *   },
 * });
 * ```
 */
export function createSecureTool<TInput extends z.ZodType, TOutput>(
  options: SecureToolOptions<TInput, TOutput>,
) {
  return createTool({
    id: options.id,
    description: options.description,
    inputSchema: options.inputSchema,
    execute: async (input: z.infer<TInput>) => {
      const startTime = Date.now();
      let result: ToolResult<TOutput>;

      try {
        result = await options.execute(input, { config, esClient });
      } catch (error: any) {
        const errorMessage = error.response?.data?.error?.reason
          || error.response?.data?.message
          || error.message
          || 'Unknown error';

        result = { type: 'error', error: errorMessage };
      }

      // PII redaction
      const { finalResult, redactionCount, redactedTypes } = match(result)({
        success: (successData) => {
          if (!config.piiRedactionEnabled) {
            return { finalResult: result, redactionCount: 0, redactedTypes: [] as string[] };
          }
          const redaction = redactPII(successData);
          return {
            finalResult: redaction.redactedData as ToolResult<TOutput>,
            redactionCount: redaction.redactionCount,
            redactedTypes: redaction.redactedTypes,
          };
        },
        error: () => ({
          finalResult: result,
          redactionCount: 0,
          redactedTypes: [] as string[],
        }),
      });

      // Audit logging
      const executionTime = Date.now() - startTime;
      const auditFields: { status: 'success' | 'error'; error_message: string | undefined } =
        match(finalResult)({
          success: () => ({ status: 'success' as const, error_message: undefined as string | undefined }),
          error: ({ error }) => ({ status: 'error' as const, error_message: error as string | undefined }),
        });

      auditLogger.log({
        timestamp: new Date().toISOString(),
        tool_called: options.id,
        input_parameters: JSON.stringify(input),
        output_size_bytes: JSON.stringify(finalResult).length,
        redaction_count: redactionCount,
        redacted_types: redactedTypes,
        execution_time_ms: executionTime,
        ...auditFields,
      });

      return finalResult;
    },
  });
}
