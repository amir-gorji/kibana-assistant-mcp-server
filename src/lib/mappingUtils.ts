/**
 * Utilities for flattening Elasticsearch index mappings into a simple
 * field-name/type list that LLM agents can reason about.
 *
 * @module
 */

/** A single field path and its Elasticsearch data type. */
export interface FieldMapping {
  /** Dot-delimited field path (e.g., `customer.address.city`). */
  field: string;
  /** Elasticsearch field type (e.g., `keyword`, `text`, `double`, `date`). */
  type: string;
}

/**
 * Flatten ES mapping properties into a flat list of field paths and types.
 * Handles nested `properties` (object/nested fields) and multi-field
 * sub-fields under the `fields` key (e.g. `customer_name.keyword`).
 */
export function flattenProperties(
  properties: Record<string, any>,
  prefix: string,
  result: FieldMapping[],
): void {
  for (const [name, mapping] of Object.entries(properties)) {
    const fieldPath = prefix ? `${prefix}.${name}` : name;

    if (mapping.type) {
      result.push({ field: fieldPath, type: mapping.type });
    }

    // Recurse into nested object / nested-type properties
    if (mapping.properties) {
      flattenProperties(mapping.properties, fieldPath, result);
    }

    // Recurse into multi-field sub-fields (.keyword, .text, etc.)
    if (mapping.fields) {
      flattenProperties(mapping.fields, fieldPath, result);
    }
  }
}
