/**
 * **get_alert_status** — Kibana alerting rules status tool.
 *
 * Retrieves the current status of Kibana alerting rules, including their
 * execution status, last run time, and tags. Supports filtering by rule type,
 * severity tag, and execution status.
 *
 * Returns a graceful error message if the Kibana Alerting plugin is not
 * available or the API key lacks the required privileges.
 *
 * @module
 */
import { z } from 'zod';
import { createSecureTool } from '../lib/toolWrapper';

/** Normalized representation of a single Kibana alerting rule. */
export interface AlertRule {
  id: string;
  name: string;
  rule_type_id: string;
  enabled: boolean;
  tags: string[];
  schedule: Record<string, any>;
  last_execution_status: string;
  last_execution_date: string | undefined;
  last_execution_status_reason: string | undefined;
}

/** Top-level response shape for alert status. */
export interface AlertStatusResult {
  total: number;
  returned: number;
  rules: AlertRule[];
}

export const getAlertStatusTool = createSecureTool({
  id: 'get_alert_status',
  description:
    'Retrieve the current status of Kibana alerting rules. Returns rule names, types, enabled state, tags, and last execution status. Use this to identify firing or erroring alerts when investigating incidents.',
  mcp: {
    annotations: {
      title: 'Get Alert Status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  inputSchema: z.object({
    severity: z
      .string()
      .optional()
      .describe('Filter rules by severity tag (e.g., "critical", "warning").'),
    rule_type: z
      .string()
      .optional()
      .describe('Filter by rule type ID (e.g., ".es-query", "apm.error_rate").'),
    status: z
      .enum(['active', 'inactive', 'error', 'ok'])
      .optional()
      .describe('Filter rules by last execution status (applied client-side).'),
    max_results: z
      .number()
      .optional()
      .default(20)
      .describe('Maximum number of rules to return. Defaults to 20.'),
  }),
  execute: async ({ severity, rule_type, status, max_results }, { esClient }) => {
    const params: Record<string, string | number> = {
      per_page: max_results,
      sort_field: 'name',
      sort_order: 'asc',
    };

    // Build KQL filter string from optional fields
    const filterParts: string[] = [];
    if (rule_type) filterParts.push(`rule_type_id: "${rule_type}"`);
    if (severity) filterParts.push(`tags: "${severity}"`);
    if (filterParts.length > 0) {
      params.filter = filterParts.join(' AND ');
    }

    let raw: any;
    try {
      raw = await esClient.findAlertingRules(params);
    } catch (error: any) {
      const httpStatus = error.response?.status;
      if (httpStatus === 404 || httpStatus === 403) {
        return {
          type: 'error' as const,
          error:
            'Kibana Alerting is not available. Ensure the Kibana alerting plugin is enabled and the API key has the required privileges.',
        };
      }
      throw error;
    }

    // Normalize Kibana rule shape
    let rules: AlertRule[] = (raw.data ?? []).map((rule: any) => ({
      id: rule.id,
      name: rule.name,
      rule_type_id: rule.rule_type_id,
      enabled: rule.enabled,
      tags: rule.tags ?? [],
      schedule: rule.schedule ?? {},
      last_execution_status: rule.execution_status?.status ?? 'unknown',
      last_execution_date: rule.execution_status?.last_execution_date,
      last_execution_status_reason: rule.execution_status?.error?.reason,
    }));

    // Client-side status filter (Kibana _find KQL doesn't reliably support execution_status.status)
    if (status) {
      rules = rules.filter((r) => r.last_execution_status === status);
    }

    return {
      type: 'success' as const,
      data: {
        total: raw.total ?? rules.length,
        returned: rules.length,
        rules,
      } satisfies AlertStatusResult,
    };
  },
});
