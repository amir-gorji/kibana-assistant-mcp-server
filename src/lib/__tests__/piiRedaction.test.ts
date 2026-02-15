import { describe, it, expect } from 'vitest';
import { redactPII } from '../piiRedaction';

describe('piiRedaction', () => {
  describe('credit card masking', () => {
    it('masks valid credit card with dashes', () => {
      const result = redactPII({ cc: '4111-1111-1111-1111' });
      expect(result.redactedData.cc).toBe('****-****-****-1111');
      expect(result.redactionCount).toBe(1);
      expect(result.redactedTypes).toContain('credit_card');
    });

    it('masks valid credit card with spaces', () => {
      const result = redactPII({ cc: '4111 1111 1111 1111' });
      expect(result.redactedData.cc).toBe('**** **** **** 1111');
      expect(result.redactionCount).toBe(1);
    });

    it('does not mask numbers that fail Luhn check', () => {
      const result = redactPII({ cc: '1234-5678-9012-3456' });
      expect(result.redactedData.cc).toBe('1234-5678-9012-3456');
      expect(result.redactionCount).toBe(0);
    });
  });

  describe('SSN masking', () => {
    it('masks SSN format', () => {
      const result = redactPII({ ssn: '123-45-6789' });
      expect(result.redactedData.ssn).toBe('***-**-****');
      expect(result.redactedTypes).toContain('ssn');
    });
  });

  describe('email masking', () => {
    it('masks email addresses', () => {
      const result = redactPII({ email: 'john.doe@bank.com' });
      expect(result.redactedData.email).toBe('j***@bank.com');
      expect(result.redactedTypes).toContain('email');
    });
  });

  describe('IBAN masking', () => {
    it('masks IBAN numbers', () => {
      const result = redactPII({ iban: 'NL91ABNA0417164300' });
      expect(result.redactedData.iban).toBe('NL91****4300');
      expect(result.redactedTypes).toContain('iban');
    });

    it('does not mask short uppercase strings', () => {
      const result = redactPII({ code: 'ACTIVE' });
      expect(result.redactedData.code).toBe('ACTIVE');
      expect(result.redactionCount).toBe(0);
    });
  });

  describe('phone masking', () => {
    it('masks phone numbers with country code', () => {
      const result = redactPII({ phone: '+31 6 1234 5678' });
      expect(result.redactedData.phone).toBe('+31***78');
      expect(result.redactedTypes).toContain('phone');
    });
  });

  describe('nested structures', () => {
    it('redacts PII in deeply nested objects', () => {
      const data = {
        user: {
          contact: {
            email: 'jane@example.com',
            ssn: '987-65-4321',
          },
        },
      };
      const result = redactPII(data);
      expect(result.redactedData.user.contact.email).toBe('j***@example.com');
      expect(result.redactedData.user.contact.ssn).toBe('***-**-****');
      expect(result.redactionCount).toBe(2);
    });

    it('redacts PII in arrays', () => {
      const data = { emails: ['alice@test.com', 'bob@test.com'] };
      const result = redactPII(data);
      expect(result.redactedData.emails[0]).toBe('a***@test.com');
      expect(result.redactedData.emails[1]).toBe('b***@test.com');
      expect(result.redactionCount).toBe(2);
    });

    it('handles non-string primitives', () => {
      const data = { count: 42, active: true, nothing: null };
      const result = redactPII(data);
      expect(result.redactedData).toEqual({ count: 42, active: true, nothing: null });
      expect(result.redactionCount).toBe(0);
    });
  });
});
