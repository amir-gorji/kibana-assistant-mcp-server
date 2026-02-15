import { describe, it, expect } from 'vitest';
import { validateReadOnlyQuery, validateIndexName } from '../inputSanitizer';

describe('inputSanitizer', () => {
  describe('validateReadOnlyQuery', () => {
    it('allows a simple match query', () => {
      expect(() =>
        validateReadOnlyQuery({ query: { match: { status: 'active' } } }),
      ).not.toThrow();
    });

    it('allows a bool query with filters', () => {
      expect(() =>
        validateReadOnlyQuery({
          query: { bool: { must: [{ term: { type: 'payment' } }] } },
        }),
      ).not.toThrow();
    });

    it('rejects queries with script keyword', () => {
      expect(() =>
        validateReadOnlyQuery({ query: { script: { source: 'doc.count' } } }),
      ).toThrow(/script/);
    });

    it('rejects queries with _update keyword', () => {
      expect(() =>
        validateReadOnlyQuery({ _update: { doc: { status: 'deleted' } } }),
      ).toThrow(/_update/);
    });

    it('rejects queries with _delete keyword', () => {
      expect(() =>
        validateReadOnlyQuery({ _delete: { id: '123' } }),
      ).toThrow(/_delete/);
    });

    it('rejects queries with _bulk keyword', () => {
      expect(() =>
        validateReadOnlyQuery({ _bulk: [{ index: {} }] }),
      ).toThrow(/_bulk/);
    });

    it('rejects queries with ctx._source keyword', () => {
      expect(() =>
        validateReadOnlyQuery({
          query: { match_all: {} },
          note: 'ctx._source.field = value',
        }),
      ).toThrow(/ctx._source/);
    });
  });

  describe('validateIndexName', () => {
    it('allows simple index names', () => {
      expect(() => validateIndexName('logs')).not.toThrow();
      expect(() => validateIndexName('logs-2024')).not.toThrow();
      expect(() => validateIndexName('logs-*')).not.toThrow();
      expect(() => validateIndexName('.kibana')).not.toThrow();
      expect(() => validateIndexName('index_name')).not.toThrow();
      expect(() => validateIndexName('logs-2024.01,logs-2024.02')).not.toThrow();
    });

    it('rejects empty index names', () => {
      expect(() => validateIndexName('')).toThrow(/Invalid index name/);
    });

    it('rejects index names with path traversal', () => {
      expect(() => validateIndexName('../etc/passwd')).toThrow(/Invalid index name/);
    });

    it('rejects index names with special characters', () => {
      expect(() => validateIndexName('logs<script>')).toThrow(/Invalid index name/);
      expect(() => validateIndexName('logs;rm -rf')).toThrow(/Invalid index name/);
    });
  });
});
