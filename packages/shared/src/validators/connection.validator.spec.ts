import { describe, it, expect } from 'vitest';
import {
  validateConnectionName,
  validateServer,
  validatePort,
  validateDatabaseName,
  validateConnectionProfile,
  sanitizeProfileName,
  sanitizeDatabaseName,
  isReservedWord,
} from './connection.validator';

describe('Connection Validators', () => {
  describe('validateConnectionName', () => {
    it('should accept valid connection names', () => {
      expect(validateConnectionName('My Connection').valid).toBe(true);
      expect(validateConnectionName('Production_DB').valid).toBe(true);
      expect(validateConnectionName('Test-123').valid).toBe(true);
    });

    it('should reject empty names', () => {
      const result = validateConnectionName('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Connection name is required');
    });

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(129);
      const result = validateConnectionName(longName);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Connection name must be 128 characters or less');
    });

    it('should warn about leading/trailing spaces', () => {
      const result = validateConnectionName('  spaced  ');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Connection name should not have leading or trailing spaces');
    });
  });

  describe('validateServer', () => {
    it('should accept valid hostnames', () => {
      expect(validateServer('localhost').valid).toBe(true);
      expect(validateServer('server.domain.com').valid).toBe(true);
      expect(validateServer('my-server').valid).toBe(true);
    });

    it('should accept valid IPv4 addresses', () => {
      expect(validateServer('192.168.1.1').valid).toBe(true);
      expect(validateServer('10.0.0.1').valid).toBe(true);
      expect(validateServer('127.0.0.1').valid).toBe(true);
    });

    it('should reject empty server', () => {
      const result = validateServer('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Server is required');
    });

    it('should reject invalid IPv4 with octets > 255', () => {
      const result = validateServer('192.168.1.256');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid IP address: octets must be 0-255');
    });
  });

  describe('validatePort', () => {
    it('should accept valid ports', () => {
      expect(validatePort(1433).valid).toBe(true);
      expect(validatePort(1).valid).toBe(true);
      expect(validatePort(65535).valid).toBe(true);
    });

    it('should reject invalid port numbers', () => {
      expect(validatePort(0).valid).toBe(false);
      expect(validatePort(65536).valid).toBe(false);
      expect(validatePort(-1).valid).toBe(false);
    });

    it('should handle string ports', () => {
      expect(validatePort('1433').valid).toBe(true);
      expect(validatePort('abc').valid).toBe(false);
    });
  });

  describe('validateDatabaseName', () => {
    it('should accept valid database names', () => {
      expect(validateDatabaseName('MyDatabase').valid).toBe(true);
      expect(validateDatabaseName('Test_DB_123').valid).toBe(true);
      expect(validateDatabaseName('_internal').valid).toBe(true);
    });

    it('should reject empty names', () => {
      const result = validateDatabaseName('');
      expect(result.valid).toBe(false);
    });

    it('should reject names starting with numbers', () => {
      const result = validateDatabaseName('123database');
      expect(result.valid).toBe(false);
    });

    it('should reject SQL reserved words', () => {
      const result = validateDatabaseName('SELECT');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('reserved word'))).toBe(true);
    });

    it('should reject system database names', () => {
      const result = validateDatabaseName('master');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('system database'))).toBe(true);
    });

    it('should reject names with invalid characters', () => {
      const result = validateDatabaseName('My Database!');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateConnectionProfile', () => {
    it('should validate a complete profile', () => {
      const result = validateConnectionProfile({
        name: 'Test Connection',
        server: 'localhost',
        port: 1433,
        authenticationType: 'sql',
        username: 'sa',
      });
      expect(result.valid).toBe(true);
    });

    it('should fail if username missing for SQL auth', () => {
      const result = validateConnectionProfile({
        name: 'Test Connection',
        server: 'localhost',
        port: 1433,
        authenticationType: 'sql',
        username: '',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('sanitizeProfileName', () => {
    it('should remove invalid characters', () => {
      expect(sanitizeProfileName('My<>Connection')).toBe('MyConnection');
      expect(sanitizeProfileName('Test:Name')).toBe('TestName');
    });

    it('should trim whitespace', () => {
      expect(sanitizeProfileName('  spaced  ')).toBe('spaced');
    });

    it('should truncate long names', () => {
      const longName = 'a'.repeat(200);
      expect(sanitizeProfileName(longName).length).toBe(128);
    });
  });

  describe('sanitizeDatabaseName', () => {
    it('should replace invalid characters', () => {
      expect(sanitizeDatabaseName('My Database')).toBe('My_Database');
      expect(sanitizeDatabaseName('test-db')).toBe('test_db');
    });

    it('should fix names starting with numbers', () => {
      expect(sanitizeDatabaseName('123database')).toBe('_23database');
    });
  });

  describe('isReservedWord', () => {
    it('should identify reserved words', () => {
      expect(isReservedWord('SELECT')).toBe(true);
      expect(isReservedWord('select')).toBe(true);
      expect(isReservedWord('FROM')).toBe(true);
      expect(isReservedWord('TABLE')).toBe(true);
    });

    it('should return false for non-reserved words', () => {
      expect(isReservedWord('MyTable')).toBe(false);
      expect(isReservedWord('Customer')).toBe(false);
    });
  });
});
