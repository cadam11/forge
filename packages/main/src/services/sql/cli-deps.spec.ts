/**
 * Unit tests for CliDepsService — backup/restore CLI tool detection.
 *
 * Verifies:
 *   - `checkTool` reports `available: true` for a tool that's definitely
 *     present (we use `node`, since these tests already run inside Node
 *     and `node --version` always works).
 *   - `checkTool` reports `available: false` for a tool that doesn't
 *     exist on PATH, without throwing.
 *   - `checkDeps('postgresql')` returns status for both pg_dump and
 *     pg_restore; `checkDeps('mysql')` covers mysqldump and mysql.
 *   - The cache short-circuits a second `checkDeps` call so we don't
 *     re-spawn version probes on every dialog open. `recheck()` bypasses
 *     the cache.
 *   - When at least one tool is missing, `installInstructions` is
 *     populated with platform-appropriate guidance.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliDepsService } from './cli-deps';

describe('CliDepsService', () => {
  let service: CliDepsService;

  beforeEach(() => {
    CliDepsService.resetInstance();
    service = CliDepsService.getInstance();
  });

  afterEach(() => {
    CliDepsService.resetInstance();
  });

  describe('checkTool', () => {
    it('returns available: true for node', async () => {
      const status = await service.checkTool('node');
      expect(status.available).toBe(true);
      expect(status.version).toMatch(/^v\d+\./);
    });

    it('returns available: false for a non-existent binary', async () => {
      const status = await service.checkTool('__joinery_does_not_exist_zzz__');
      expect(status.available).toBe(false);
      expect(status.version).toBeUndefined();
    });
  });

  describe('checkDeps', () => {
    it('reports both tools for postgresql', async () => {
      const result = await service.checkDeps('postgresql');
      const names = result.tools.map(t => t.tool).sort();
      expect(names).toEqual(['pg_dump', 'pg_restore']);
      expect(result.engine).toBe('postgresql');
      expect(typeof result.platform).toBe('string');
    });

    it('reports both tools for mysql', async () => {
      const result = await service.checkDeps('mysql');
      const names = result.tools.map(t => t.tool).sort();
      expect(names).toEqual(['mysql', 'mysqldump']);
      expect(result.engine).toBe('mysql');
    });

    it('flags allAvailable based on per-tool availability', async () => {
      const result = await service.checkDeps('postgresql');
      const expected = result.tools.every(t => t.available);
      expect(result.allAvailable).toBe(expected);
    });

    it('caches the result for subsequent calls on the same engine', async () => {
      const first = await service.checkDeps('postgresql');
      const second = await service.checkDeps('postgresql');
      // Object identity proves we hit the cache rather than re-running probes.
      expect(second).toBe(first);
    });

    it('recheck bypasses the cache and produces a fresh result', async () => {
      const first = await service.checkDeps('postgresql');
      const second = await service.recheck('postgresql');
      // Same shape, but different object identity since recheck rebuilds.
      expect(second).not.toBe(first);
      expect(second.engine).toBe(first.engine);
      expect(second.tools.map(t => t.tool).sort()).toEqual(first.tools.map(t => t.tool).sort());
    });
  });

  describe('install instructions', () => {
    it('includes installInstructions when at least one tool is missing', async () => {
      // Simulate a missing-tools result by injecting one. We don't want to
      // depend on the host actually missing pg_dump in CI.
      const stub = await service.buildResult('postgresql', [
        { tool: 'pg_dump', available: false },
        { tool: 'pg_restore', available: true, version: 'pg_restore (PostgreSQL) 16.0' },
      ]);
      expect(stub.allAvailable).toBe(false);
      expect(
        stub.installInstructions,
        'expected install instructions when a tool is missing'
      ).toBeDefined();
      expect(stub.installInstructions!.engine).toBe('postgresql');
      expect(stub.installInstructions!.steps.length).toBeGreaterThan(0);
    });

    it('omits installInstructions when all tools are available', async () => {
      const stub = await service.buildResult('mysql', [
        { tool: 'mysqldump', available: true, version: 'mysqldump 9.0' },
        { tool: 'mysql', available: true, version: 'mysql 9.0' },
      ]);
      expect(stub.allAvailable).toBe(true);
      expect(stub.installInstructions).toBeUndefined();
    });

    it('falls back to a generic instruction set on unsupported platforms', async () => {
      const stub = await service.buildResult(
        'postgresql',
        [
          { tool: 'pg_dump', available: false },
          { tool: 'pg_restore', available: false },
        ],
        'aix' // not in our supported platform list
      );
      expect(stub.installInstructions).toBeDefined();
      expect(stub.installInstructions!.steps.length).toBeGreaterThan(0);
    });
  });
});
