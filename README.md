# Kibana MCP Server for Digital Banking

A secure [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that connects LLM-powered agents to Elasticsearch and Kibana. Built for digital banking teams where Business Managers, Architects, and Developers need conversational access to operational data — without writing KQL or Elasticsearch DSL by hand.

---

## Table of Contents

1. [Why This Exists](#1-why-this-exists)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Quick Start](#4-quick-start)
   - [Prerequisites](#prerequisites)
   - [Install & Build](#install--build)
   - [Configure](#configure)
   - [Run](#run)
   - [Connect to Claude Desktop](#connect-to-claude-desktop)
5. [Tools Reference](#5-tools-reference)
   - [discover_cluster](#discover_cluster)
   - [kibana_search](#kibana_search)
   - [check_cluster_health](#check_cluster_health)
   - [get_alert_status](#get_alert_status)
6. [Prompts & Resources](#6-prompts--resources)
7. [Security & Compliance](#7-security--compliance)
   - [PII Redaction](#pii-redaction)
   - [Input Sanitization](#input-sanitization)
   - [Index Access Control](#index-access-control)
   - [Audit Trail](#audit-trail)
8. [Type System](#8-type-system)
9. [Testing](#9-testing)
10. [Project Structure](#10-project-structure)
11. [Roadmap](#11-roadmap)
12. [License](#12-license)

---

## 1. Why This Exists

Digital banking tribes sit on massive telemetry: payment rails (SWIFT gpi, SEPA), customer session data, APM traces, and microservice logs. Querying this data today requires mastering Elasticsearch DSL or relying on pre-built Kibana dashboards that may not answer ad-hoc questions.

This MCP server bridges that gap. It lets an LLM agent discover your cluster, understand index structures, execute read-only queries, and check platform health — all through a secure, audited pipeline that redacts PII before data ever leaves your infrastructure.

| Persona                | What they get                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Business Manager**   | Ask natural-language questions about transaction volumes, onboarding funnels, or liquidity metrics. The agent builds the DSL query for you.      |
| **Software Architect** | Explore cluster topology, review index mappings, and assess system health without context-switching to Kibana.                                   |
| **Developer**          | Debug by correlating logs across microservices. Search for error patterns, trace transaction IDs, and inspect alerting rules — conversationally. |

---

## 2. Features

- **Cluster Discovery** — Auto-discovers indices, field mappings, and doc counts so the agent knows what data is available before querying.
- **Read-Only Search** — Executes Elasticsearch DSL queries with enforced read-only guardrails. Blocked keywords (`_update`, `_delete`, `_bulk`, `script`) are rejected at the input sanitization layer.
- **Cluster Health** — Returns overall cluster status (green/yellow/red), node counts, shard counts, and unassigned shard details at cluster, index, or shard granularity.
- **Alert Status** — Retrieves Kibana alerting rules with their last execution status, supporting filtering by rule type, severity tag, and execution state.
- **Time Range Filtering** — Natural time expressions (`now-24h`, `now-7d`) are merged into any query shape (bool, simple, or empty) automatically.
- **PII Redaction** — Credit cards (Luhn-validated), IBANs, SSNs, emails, and phone numbers are masked before results reach the LLM. Defense-in-depth for PCI DSS and GDPR compliance.
- **Audit Logging** — Every tool invocation is logged to stderr with tool name, parameters, execution time, redaction counts, and error details.
- **Index Access Control** — Restrict which indices the agent can touch via `ALLOWED_INDEX_PATTERNS`.
- **Retry with Backoff** — Transient failures (429, 503, network errors) are retried with exponential backoff.

---

## 3. Architecture

```
┌─────────────┐     stdio / SSE      ┌──────────────────────┐
│  LLM Agent  │ ◄──────────────────► │   MCP Server         │
│  (Claude,   │                      │                      │
│   GPT, etc) │                      │  ┌────────────────┐  │
└─────────────┘                      │  │ Input Sanitizer │  │
                                     │  └───────┬────────┘  │
                                     │          ▼           │
                                     │  ┌────────────────┐  │
                                     │  │  Tool Execute   │  │
                                     │  └───────┬────────┘  │
                                     │          ▼           │
                                     │  ┌────────────────┐  │
                                     │  │ PII Redaction   │  │
                                     │  └───────┬────────┘  │
                                     │          ▼           │
                                     │  ┌────────────────┐  │
                                     │  │ Audit Logger    │  │
                                     │  └────────────────┘  │
                                     └──────────┬───────────┘
                                                │
                                                ▼
                                     ┌──────────────────────┐
                                     │   Elasticsearch /    │
                                     │   Kibana Cluster     │
                                     └──────────────────────┘
```

Every tool invocation flows through a secure pipeline: **validate input** → **execute query** → **redact PII** → **log audit entry** → **return result**. This pipeline is implemented once in `createSecureTool` and shared by all tools.

---

## 4. Quick Start

### Prerequisites

- Node.js 18+
- An Elasticsearch / Kibana deployment (Elastic Cloud or self-hosted)
- An API key with read-only privileges on the indices you want to expose

### Install & Build

```bash
git clone <this-repo>
cd kibana-assistant-mcp-server
npm install
npm run build:mcp
```

### Configure

Create a `.env` file or export environment variables:

```bash
# Required
export KIBANA_URL="https://your-deployment.kb.us-east-1.aws.found.io"
export KIBANA_API_KEY="your-base64-encoded-api-key"

# Optional
export ALLOWED_INDEX_PATTERNS="logs-*,transactions-*"  # Comma-separated. Empty = all indices.
export MAX_SEARCH_SIZE="100"                            # Max docs per search (1-500, default 100)
export REQUEST_TIMEOUT_MS="30000"                       # HTTP timeout (default 30s)
export RETRY_ATTEMPTS="3"                               # Retry count for transient failures
export RETRY_DELAY_MS="1000"                            # Base delay for exponential backoff
export KIBANA_SPACE=""                                  # Kibana space (empty = default space)
export AUDIT_ENABLED="true"                             # Audit logging to stderr (default true)
export PII_REDACTION_ENABLED="true"                     # PII masking (default true)
```

> **Note:** The Elasticsearch URL is derived automatically from the Kibana URL by replacing `.kb.` with `.es.` in the hostname. This convention matches Elastic Cloud deployments.

### Run

```bash
node dist/stdio.mjs
```

### Connect to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kibana": {
      "command": "node",
      "args": ["/absolute/path/to/dist/stdio.mjs"],
      "env": {
        "KIBANA_URL": "https://your-deployment.kb.us-east-1.aws.found.io",
        "KIBANA_API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## 5. Tools Reference

### `discover_cluster`

**Start here.** Discovers all available indices and their field mappings. The agent should call this first to understand what data exists before constructing queries.

| Parameter        | Type    | Default | Description                              |
| ---------------- | ------- | ------- | ---------------------------------------- |
| `pattern`        | string  | `*`     | Index pattern filter (e.g., `logs-*`)    |
| `include_hidden` | boolean | `false` | Include system indices (`.kibana`, etc.) |
| `max_indices`    | number  | `50`    | Cap on indices to fetch mappings for     |

Returns indices sorted by doc count (largest first), each with a flat list of `{ field, type }` mappings.

---

### `kibana_search`

Executes a read-only Elasticsearch DSL query against an index.

| Parameter    | Type   | Default    | Description                                        |
| ------------ | ------ | ---------- | -------------------------------------------------- |
| `index`      | string | _required_ | Index pattern to search (e.g., `transactions-*`)   |
| `query`      | object | _required_ | Elasticsearch DSL query body                       |
| `size`       | number | `10`       | Results to return (capped by `MAX_SEARCH_SIZE`)    |
| `time_range` | string | —          | Time filter expression (e.g., `now-24h`, `now-7d`) |

The `time_range` parameter is automatically merged into whatever query shape you provide — bool queries, simple queries, or empty queries all work.

---

### `check_cluster_health`

Returns the health status of the Elasticsearch cluster. Use this to diagnose degraded or red clusters and verify platform health before investigating query or performance problems.

| Parameter | Type   | Default     | Description                                                                  |
| --------- | ------ | ----------- | ---------------------------------------------------------------------------- |
| `level`   | enum   | `"cluster"` | Granularity: `"cluster"`, `"indices"`, or `"shards"`. Higher levels include per-index or per-shard detail. |

Returns `status` (green / yellow / red), node counts, shard counts, and `unassigned_shards`.

---

### `get_alert_status`

Retrieves Kibana alerting rules and their last execution status. Use this when investigating incidents to identify firing or erroring alerts. Returns a graceful error message if the Kibana Alerting plugin is not enabled or the API key lacks the required privileges.

| Parameter     | Type   | Default | Description                                                              |
| ------------- | ------ | ------- | ------------------------------------------------------------------------ |
| `severity`    | string | —       | Filter by severity tag (e.g., `"critical"`, `"warning"`)                 |
| `rule_type`   | string | —       | Filter by rule type ID (e.g., `".es-query"`, `"apm.error_rate"`)         |
| `status`      | enum   | —       | Client-side filter: `"active"`, `"inactive"`, `"error"`, or `"ok"`      |
| `max_results` | number | `20`    | Maximum number of rules to return                                        |

---

## 6. Prompts & Resources

The server exposes MCP **prompts** (guided workflows) and **resources** (static reference documents) alongside its tools.

**Prompts** provide step-by-step investigation workflows that an LLM can follow:

| Prompt                            | Purpose                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `investigate_failed_transactions` | Guided workflow for diagnosing payment failures in Elasticsearch     |
| `compliance_audit_query`          | Structured approach to building PCI DSS / AML audit queries         |
| `performance_investigation`       | Step-by-step investigation of latency or throughput regressions      |

**Resources** are static reference documents the LLM can read:

| Resource                        | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `banking_query_patterns`        | Common Elasticsearch query patterns for banking data              |
| `elasticsearch_best_practices`  | Query optimization and index hygiene guidelines                   |
| `banking_domain_glossary`       | Definitions for domain terms (SWIFT, SEPA, IBAN, liquidity, etc.) |

---

## 7. Security & Compliance

This server is designed for regulated environments. Multiple defense layers ensure sensitive data never reaches the LLM unprotected.

### PII Redaction

All tool responses pass through a redaction layer before leaving the server. The following patterns are detected and masked:

| Data Type   | Example Input            | Masked Output         |
| ----------- | ------------------------ | --------------------- |
| Credit Card | `4111 1111 1111 1111`    | `**** **** **** 1111` |
| IBAN        | `DE89370400440532013000` | `DE89****3000`        |
| SSN         | `123-45-6789`            | `***-**-****`         |
| Email       | `john.doe@bank.com`      | `j***@bank.com`       |
| Phone       | `+1 555-123-4567`        | `+15***67`            |

Credit card detection uses Luhn validation to avoid false positives on random 16-digit numbers.

### Input Sanitization

Every query is scanned for dangerous keywords before execution:

- `script`, `_update`, `_delete`, `_bulk`, `ctx._source`

Index names are validated against a strict regex (`[a-zA-Z0-9\-.*,_]+`) to prevent injection.

### Index Access Control

Set `ALLOWED_INDEX_PATTERNS` to restrict which indices the agent can query. When set, any request to an index outside these patterns is rejected. This enforces the **Principle of Least Privilege** at the MCP layer, complementing Elastic's native RBAC.

### Audit Trail

Every tool invocation produces a structured JSON log entry to stderr:

```json
{
  "timestamp": "2026-02-15T10:30:00.000Z",
  "tool_called": "kibana_search",
  "input_parameters": "{\"index\":\"transactions-*\",...}",
  "output_size_bytes": 4521,
  "redaction_count": 3,
  "redacted_types": ["credit_card", "email"],
  "execution_time_ms": 245,
  "status": "success"
}
```

Input parameters are truncated at 500 characters to prevent sensitive data from leaking into logs.

---

## 8. Type System

Tool results use [dismatch](https://www.npmjs.com/package/dismatch) discriminated unions for type-safe pattern matching:

```ts
import type { Model } from 'dismatch';

type ToolResult<T> = ToolSuccess<T> | ToolError;
type ToolSuccess<T> = Model<
  'success',
  { data: T; total?: number; aggregations?: Record<string, any> }
>;
type ToolError = Model<'error', { error: string }>;
```

The `type` field (`'success'` | `'error'`) is the discriminant. All branching on tool results uses `match()` from dismatch for exhaustive, compile-time-checked pattern matching — no `if/else` chains or `switch` statements.

---

## 9. Testing

The server ships with a comprehensive test suite built on [Vitest](https://vitest.dev/). Tests are co-located with their modules under `__tests__/` directories.

```bash
npm test
```

**Unit tests** cover individual library modules in isolation:

| Module              | What is tested                                              |
| ------------------- | ----------------------------------------------------------- |
| `piiRedaction`      | Pattern detection accuracy, Luhn validation, masking format |
| `inputSanitizer`    | Blocked keyword detection, index name validation            |
| `mappingUtils`      | Field flattening, multi-field expansion, deduplication      |
| `auditLogger`       | Log format, truncation, stderr routing                      |

**Integration tests** exercise the full tool execution pipeline end-to-end (input → execute → PII redaction → result), with the HTTP layer replaced by mock fns:

| Tool / Module             | Key scenarios covered                                             |
| ------------------------- | ----------------------------------------------------------------- |
| `discoverCluster`         | Index discovery, hidden-index filtering, mapping fetch failures   |
| `checkClusterHealth`      | Cluster/indices/shards level output, argument pass-through        |
| `getAlertStatus`          | Rule normalization, KQL filter building, 404/403 graceful errors  |
| `prompts`                 | Prompt registration, argument schemas, template rendering         |
| `resources`               | Resource registration, URI resolution, content integrity          |

All 82 tests pass on the current build.

---

## 10. Project Structure

```
src/
├── lib/
│   ├── types.ts                    # ToolResult<T> discriminated union
│   ├── config.ts                   # Environment-based configuration loader
│   ├── esClient.ts                 # Elasticsearch/Kibana HTTP client with retry
│   ├── toolWrapper.ts              # Secure tool pipeline (sanitize → execute → redact → audit)
│   ├── piiRedaction.ts             # Regex-based PII detection and masking
│   ├── inputSanitizer.ts           # Query validation and index name sanitization
│   ├── auditLogger.ts              # Structured audit logging to stderr
│   ├── mappingUtils.ts             # Elasticsearch mapping flattener
│   └── __tests__/                  # Unit tests for lib modules
├── tools/
│   ├── index.ts                    # Tool registry
│   ├── discoverCluster.ts          # discover_cluster tool
│   ├── kibanaSearch.ts             # kibana_search tool
│   ├── checkClusterHealth.ts       # check_cluster_health tool
│   ├── getAlertStatus.ts           # get_alert_status tool
│   └── __tests__/                  # Integration tests for tools
├── prompts/
│   ├── index.ts                    # Prompt registry
│   ├── investigateFailedTransactions.ts
│   ├── complianceAuditQuery.ts
│   ├── performanceInvestigation.ts
│   └── __tests__/
├── resources/
│   ├── index.ts                    # Resource registry
│   ├── bankingQueryPatterns.ts
│   ├── elasticsearchBestPractices.ts
│   ├── bankingDomainGlossary.ts
│   └── __tests__/
└── mastra/
    └── stdio.ts                    # MCP server entry point (stdio transport)
```

---

## 11. Roadmap

This server implements the **Phase 1 foundation** of the strategic architecture described in the companion document. Future phases include:

- **Business Intelligence Tools** — `analyze_banking_funnel`, `get_liquidity_metrics`, `compare_cohort_retention` for the Manager persona
- **Observability Tools** — `search_error_clusters`, `trace_transaction_journey` for the Developer persona
- **Knowledge Base** — Semantic discovery of Kibana saved objects (dashboards, visualizations) via `find_knowledge_assets`
- **SSE Transport** — HTTP/SSE deployment for multi-agent access from Slack, Teams, or internal platforms
- **Async Search** — `_async_search` support for long-running aggregations over large time horizons

---

## 12. License

MIT — free to use, modify, and distribute.
