/**
 * CLI Dependency Probe — checks whether the host has the right binaries
 * for backup/restore on a given engine.
 *
 * PG and MySQL backup/restore in Joinery shells out to host-installed CLI
 * tools (`pg_dump` / `pg_restore` for Postgres, `mysqldump` / `mysql`
 * for MySQL). Those are NOT bundled with the app — see CLAUDE.md for
 * the rationale. The renderer queries this service before opening the
 * backup/restore form so it can substitute a setup-instructions view
 * when the binaries are missing, instead of letting the user fill in
 * the form and then fail with a cryptic spawn ENOENT.
 *
 * Caching: results are cached per-engine for the lifetime of the main
 * process. Renderer can call `recheck()` to bypass the cache after the
 * user installs the missing tools.
 */

import { spawn } from 'child_process';

import {
  getCliInstallInstructions,
  type CliDepsResult,
  type CliEngine,
  type CliToolStatus,
} from '@joinery/shared';

import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';

const log = createLogger('CliDeps');

const ENGINE_TOOLS: Record<CliEngine, readonly string[]> = {
  postgresql: ['pg_dump', 'pg_restore'],
  mysql: ['mysqldump', 'mysql'],
};

const VERSION_PROBE_TIMEOUT_MS = 5_000;

export class CliDepsService extends BaseSingleton {
  private cache: Map<CliEngine, CliDepsResult> = new Map();

  /**
   * Return the cached result for `engine` or run a fresh probe.
   * Renderer call sites use this on dialog open.
   */
  async checkDeps(engine: CliEngine): Promise<CliDepsResult> {
    const hit = this.cache.get(engine);
    if (hit) return hit;
    return this.recheck(engine);
  }

  /**
   * Bypass the cache and re-run the probe. Renderer's "Re-check" button
   * after the user installs the missing tools.
   */
  async recheck(engine: CliEngine): Promise<CliDepsResult> {
    const tools = ENGINE_TOOLS[engine];
    const statuses = await Promise.all(tools.map(t => this.checkTool(t)));
    const result = this.buildResult(engine, statuses);
    this.cache.set(engine, result);
    log.info(
      `Probed ${engine}: ${statuses.map(s => `${s.tool}=${s.available ? 'ok' : 'MISSING'}`).join(', ')}`
    );
    return result;
  }

  /**
   * Spawn `<tool> --version` and report whether it succeeded. Resolves
   * (never rejects) so callers can probe many tools in parallel without
   * try/catch noise. Bounded by VERSION_PROBE_TIMEOUT_MS so a stuck
   * binary can't hang the dialog open forever.
   */
  checkTool(tool: string): Promise<CliToolStatus> {
    return new Promise(resolve => {
      let stdout = '';
      let resolved = false;

      const finish = (status: CliToolStatus): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(status);
      };

      const proc = spawn(tool, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        log.warn(`Version probe for ${tool} timed out after ${VERSION_PROBE_TIMEOUT_MS}ms`);
        finish({ tool, available: false });
      }, VERSION_PROBE_TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on('close', code => {
        if (code === 0) {
          const version = stdout.trim().split('\n')[0] || undefined;
          finish({ tool, available: true, version });
        } else {
          finish({ tool, available: false });
        }
      });

      proc.on('error', () => {
        // ENOENT (binary not on PATH) lands here. Any other spawn error
        // is also a not-available outcome from the user's perspective.
        finish({ tool, available: false });
      });
    });
  }

  /**
   * Assemble a result from a list of tool statuses. Exposed so unit
   * tests can build deterministic results without depending on the
   * actual host's PATH state. Optional `platformOverride` lets tests
   * exercise the generic-fallback branch.
   */
  buildResult(
    engine: CliEngine,
    statuses: CliToolStatus[],
    platformOverride?: string
  ): CliDepsResult {
    const platform = platformOverride ?? process.platform;
    const allAvailable = statuses.every(s => s.available);
    return {
      engine,
      platform,
      tools: statuses,
      allAvailable,
      installInstructions: allAvailable ? undefined : getCliInstallInstructions(engine, platform),
    };
  }

  /**
   * Wipe the cache. Used on app shutdown / for tests.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
