/**
 * Input validation for Elasticsearch queries and index names.
 *
 * Provides two guardrails that run before any query reaches the cluster:
 * 1. **Read-only enforcement** — rejects queries containing write/script keywords.
 * 2. **Index name validation** — ensures names contain only safe characters.
 *
 * These checks are a defense-in-depth measure on top of Elastic's native RBAC.
 * Even if the API key has broader permissions, the MCP layer blocks dangerous
 * operations at the application level.
 *
 * @module
 */

/** Keywords that indicate a write or scripting operation. */
const BLOCKED_KEYWORDS = ['script', '_update', '_delete', '_bulk', 'ctx._source'];

/** Only allow alphanumeric, hyphens, dots, asterisks, commas, and underscores. */
const INDEX_NAME_REGEX = /^[a-zA-Z0-9\-.*,_]+$/;

/**
 * Rejects queries containing write or scripting keywords.
 *
 * Serializes the query to JSON and scans for blocked keywords. This prevents
 * the LLM from constructing update-by-query, delete, or script operations.
 *
 * @param query - The Elasticsearch DSL query object.
 * @throws {Error} If a blocked keyword is found in the serialized query.
 */
export function validateReadOnlyQuery(query: Record<string, any>): void {
  const serialized = JSON.stringify(query).toLowerCase();
  for (const keyword of BLOCKED_KEYWORDS) {
    if (serialized.includes(keyword)) {
      throw new Error(
        `Query rejected: contains blocked keyword "${keyword}". Only read-only queries are allowed.`,
      );
    }
  }
}

/**
 * Validates that an index name contains only safe characters.
 *
 * Prevents path traversal and injection attacks by restricting the character
 * set to `[a-zA-Z0-9\-.*,_]`.
 *
 * @param index - The index name or pattern to validate.
 * @throws {Error} If the index name contains invalid characters.
 */
export function validateIndexName(index: string): void {
  if (!index || !INDEX_NAME_REGEX.test(index)) {
    throw new Error(
      `Invalid index name "${index}". Only alphanumeric characters, hyphens, dots, asterisks, commas, and underscores are allowed.`,
    );
  }
}
