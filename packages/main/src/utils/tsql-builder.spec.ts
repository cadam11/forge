import { describe, it, expect } from 'vitest';
import { TsqlBuilder } from './tsql-builder';

describe('TsqlBuilder', () => {
  describe('escapeIdentifier', () => {
    it('should wrap identifiers in brackets', () => {
      expect(TsqlBuilder.escapeIdentifier('MyTable')).toBe('[MyTable]');
    });

    it('should escape brackets within identifiers', () => {
      expect(TsqlBuilder.escapeIdentifier('My[Table]')).toBe('[My[Table]]]');
    });
  });

  describe('escapeString', () => {
    it('should return the string unchanged if no quotes', () => {
      expect(TsqlBuilder.escapeString('hello')).toBe('hello');
    });

    it('should escape single quotes', () => {
      expect(TsqlBuilder.escapeString("it's")).toBe("it''s");
    });
  });

  describe('createDatabase', () => {
    it('should generate basic CREATE DATABASE', () => {
      const sql = TsqlBuilder.createDatabase({ name: 'TestDB' });
      expect(sql).toContain('CREATE DATABASE [TestDB]');
    });

    it('should include collation when specified', () => {
      const sql = TsqlBuilder.createDatabase({
        name: 'TestDB',
        collation: 'SQL_Latin1_General_CP1_CI_AS',
      });
      expect(sql).toContain('COLLATE SQL_Latin1_General_CP1_CI_AS');
    });

    it('should include recovery model when specified', () => {
      const sql = TsqlBuilder.createDatabase({
        name: 'TestDB',
        recoveryModel: 'simple',
      });
      expect(sql).toContain('ALTER DATABASE [TestDB]');
      expect(sql).toContain('SET RECOVERY SIMPLE');
    });
  });

  describe('renameDatabase', () => {
    it('should generate rename statements', () => {
      const sql = TsqlBuilder.renameDatabase({
        currentName: 'OldName',
        newName: 'NewName',
      });
      expect(sql).toContain('ALTER DATABASE [OldName]');
      expect(sql).toContain('MODIFY NAME = [NewName]');
    });

    it('should include connection closing when requested', () => {
      const sql = TsqlBuilder.renameDatabase({
        currentName: 'OldName',
        newName: 'NewName',
        closeConnections: true,
      });
      expect(sql).toContain('SET SINGLE_USER');
      expect(sql).toContain('ROLLBACK IMMEDIATE');
      expect(sql).toContain('SET MULTI_USER');
    });
  });

  describe('deleteDatabase', () => {
    it('should generate DROP DATABASE', () => {
      const sql = TsqlBuilder.deleteDatabase({ name: 'TestDB' });
      expect(sql).toContain('DROP DATABASE [TestDB]');
    });

    it('should include connection closing when requested', () => {
      const sql = TsqlBuilder.deleteDatabase({
        name: 'TestDB',
        closeConnections: true,
      });
      expect(sql).toContain('SET SINGLE_USER');
      expect(sql).toContain('ROLLBACK IMMEDIATE');
    });
  });

  describe('backup', () => {
    it('should generate BACKUP DATABASE', () => {
      const sql = TsqlBuilder.backup({
        databaseName: 'TestDB',
        destinationPath: '/backup/test.bak',
        backupType: 'full',
        compression: false,
        verify: false,
      });
      expect(sql).toContain('BACKUP DATABASE [TestDB]');
      expect(sql).toContain("TO DISK = N'/backup/test.bak'");
    });

    it('should include compression when specified', () => {
      const sql = TsqlBuilder.backup({
        databaseName: 'TestDB',
        destinationPath: '/backup/test.bak',
        backupType: 'full',
        compression: true,
        verify: false,
      });
      expect(sql).toContain('COMPRESSION');
    });

    it('should handle copy-only backups', () => {
      const sql = TsqlBuilder.backup({
        databaseName: 'TestDB',
        destinationPath: '/backup/test.bak',
        backupType: 'full_copy_only',
        compression: false,
        verify: false,
      });
      expect(sql).toContain('COPY_ONLY');
    });

    it('should include description when specified', () => {
      const sql = TsqlBuilder.backup({
        databaseName: 'TestDB',
        destinationPath: '/backup/test.bak',
        backupType: 'full',
        compression: false,
        verify: false,
        description: 'Test backup',
      });
      expect(sql).toContain("DESCRIPTION = N'Test backup'");
    });
  });

  describe('restore', () => {
    it('should generate RESTORE DATABASE', () => {
      const sql = TsqlBuilder.restore({
        sourcePath: '/backup/test.bak',
        targetDatabaseName: 'RestoredDB',
        overwriteExisting: false,
        fileMoves: [],
        recoveryState: 'recovery',
      });
      expect(sql).toContain('RESTORE DATABASE [RestoredDB]');
      expect(sql).toContain("FROM DISK = N'/backup/test.bak'");
    });

    it('should include REPLACE when overwriting', () => {
      const sql = TsqlBuilder.restore({
        sourcePath: '/backup/test.bak',
        targetDatabaseName: 'RestoredDB',
        overwriteExisting: true,
        fileMoves: [],
        recoveryState: 'recovery',
      });
      expect(sql).toContain('REPLACE');
    });

    it('should include file moves', () => {
      const sql = TsqlBuilder.restore({
        sourcePath: '/backup/test.bak',
        targetDatabaseName: 'RestoredDB',
        overwriteExisting: false,
        fileMoves: [
          { logicalName: 'TestDB', destinationPath: '/data/test.mdf' },
          { logicalName: 'TestDB_Log', destinationPath: '/data/test.ldf' },
        ],
        recoveryState: 'recovery',
      });
      expect(sql).toContain("MOVE N'TestDB' TO N'/data/test.mdf'");
      expect(sql).toContain("MOVE N'TestDB_Log' TO N'/data/test.ldf'");
    });

    it('should handle NORECOVERY state', () => {
      const sql = TsqlBuilder.restore({
        sourcePath: '/backup/test.bak',
        targetDatabaseName: 'RestoredDB',
        overwriteExisting: false,
        fileMoves: [],
        recoveryState: 'norecovery',
      });
      expect(sql).toContain('NORECOVERY');
    });
  });
});
