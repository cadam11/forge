/**
 * Client for the sqlglot Python microservice.
 *
 * Vendored from @memberjunction/sqlglot-ts v5.51.0 (ISC licensed, MemberJunction)
 * and trimmed to the five members Forge uses: start, stop, transpile, IsRunning,
 * Port. The transpiler itself is Python's sqlglot by Toby Mao (MIT) —
 * https://github.com/tobymao/sqlglot.
 *
 * Deliberate differences from upstream:
 *
 * 1. `serverPath` is required. Upstream auto-detected it relative to its own
 *    dist/ directory, which resolves inside app.asar in a packaged build. The
 *    asar shim virtualizes paths for Node's fs — so its existsSync() check
 *    passed — but not for a spawned process, so python3 could never open the
 *    file and the feature failed as "Python 3 is required".
 * 2. The readiness poll is bounded by an explicit attempt count as well as a
 *    deadline (CLAUDE.md: bound every loop).
 * 3. No SIGINT/SIGTERM handlers. Upstream registered handlers that called
 *    process.exit(0) — a library able to terminate the Electron main process.
 *    Shutdown is driven by the app's own hook in packages/main/src/index.ts.
 *
 * Compiled as CommonJS with the rest of packages/main, which also removes the
 * ESM-only dependency that worked only because Electron's Node supports
 * require(esm).
 */

import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { SqlGlotClientOptions, TranspileOptions, TranspileResult } from './types';

/** Upper bound on readiness polls; with READY_POLL_INTERVAL_MS this covers 30s. */
const READY_POLL_MAX_ATTEMPTS = 600;
const READY_POLL_INTERVAL_MS = 50;
/** How long to wait for a graceful SIGTERM before escalating to SIGKILL. */
const STOP_GRACE_MS = 5000;
/** Bytes of child stderr surfaced in a startup failure message. */
const STDERR_EXCERPT_LIMIT = 500;

export class SqlGlotClient {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private stopping = false;
  private exitHandler: (() => void) | null = null;

  private readonly serverPath: string;
  private readonly pythonPath: string;
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: SqlGlotClientOptions) {
    if (!options?.serverPath) {
      throw new Error('SqlGlotClient requires an explicit serverPath.');
    }
    this.serverPath = options.serverPath;
    this.pythonPath = options.pythonPath ?? 'python3';
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60000;
  }

  /** Whether the Python microservice is currently running. */
  get IsRunning(): boolean {
    return this.process !== null && this.port !== null && !this.stopping;
  }

  /** The port the microservice is listening on, or null when not running. */
  get Port(): number | null {
    return this.port;
  }

  /** Start the microservice and wait until it answers /health. No-op if running. */
  async start(): Promise<void> {
    if (this.IsRunning) return;

    // Checked here rather than at spawn time so the failure names the real
    // problem instead of a generic ENOENT that the caller blames on Python.
    if (!existsSync(this.serverPath)) {
      throw new Error(`sqlglot server script not found at ${this.serverPath}`);
    }

    this.stopping = false;
    const { proc, port } = await this.spawnServer();
    this.process = proc;
    this.port = port;
    this.registerExitCleanup();

    try {
      await this.waitForReady();
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  /** Spawn python3 and resolve once the server announces its port on stdout. */
  private spawnServer(): Promise<{ proc: ChildProcess; port: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, [this.serverPath, '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let settled = false;

      /** Resolve/reject exactly once, always clearing the timer. */
      const settle = (err: Error | null, value?: { proc: ChildProcess; port: number }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value!);
      };

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        settle(
          new Error(
            `sqlglot server failed to start within ${this.startupTimeoutMs}ms. ` +
              `stderr: ${stderrBuffer.slice(0, STDERR_EXCERPT_LIMIT)}`
          )
        );
      }, this.startupTimeoutMs);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const match = stdoutBuffer.match(/SQLGLOT_PORT=(\d+)/);
        if (match) settle(null, { proc, port: parseInt(match[1], 10) });
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });

      proc.on('error', (err: Error) => {
        settle(new Error(`Failed to spawn Python process: ${err.message}`));
      });

      proc.on('exit', (code: number | null) => {
        settle(
          new Error(
            `Python process exited with code ${code} before becoming ready. ` +
              `stderr: ${stderrBuffer.slice(0, STDERR_EXCERPT_LIMIT)}`
          )
        );
        // The process died after we handed it out — drop our reference to it.
        if (this.process === proc) {
          this.process = null;
          this.port = null;
        }
      });
    });
  }

  /** Stop the microservice. Resolves once the child has exited. No-op if stopped. */
  async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) return;

    this.stopping = true;
    this.process = null;
    this.port = null;
    this.unregisterExitCleanup();

    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, STOP_GRACE_MS);

      proc.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      proc.kill('SIGTERM');
    });

    this.stopping = false;
  }

  /** Transpile SQL from one dialect to another. All statements go as one batch. */
  async transpile(sql: string, options: TranspileOptions): Promise<TranspileResult> {
    if (!this.IsRunning) {
      throw new Error('SqlGlotClient is not running. Call start() first.');
    }
    return this.httpRequest<TranspileResult>('POST', '/transpile', {
      sql,
      from_dialect: options.fromDialect,
      to_dialect: options.toDialect,
      pretty: options.pretty ?? true,
      error_level: options.errorLevel ?? 'WARN',
    });
  }

  /**
   * Poll /health until the server answers. Bounded by BOTH an attempt count and
   * the startup deadline, so it can never spin indefinitely.
   */
  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;

    for (let attempt = 0; attempt < READY_POLL_MAX_ATTEMPTS; attempt++) {
      if (Date.now() >= deadline) break;
      try {
        await this.httpRequest('GET', '/health');
        return;
      } catch {
        // Not up yet — the server is still importing sqlglot. Retry until bounded.
        await new Promise(r => setTimeout(r, READY_POLL_INTERVAL_MS));
      }
    }

    throw new Error(`sqlglot server did not become ready within ${this.startupTimeoutMs}ms`);
  }

  /**
   * Kill the child if the main process exits, so a crash cannot orphan a Python
   * process. 'exit' only — it must stay synchronous, and unlike upstream's
   * SIGINT/SIGTERM handlers it never calls process.exit() itself.
   */
  private registerExitCleanup(): void {
    if (this.exitHandler) return;
    this.exitHandler = () => {
      this.process?.kill('SIGTERM');
      this.process = null;
      this.port = null;
    };
    process.on('exit', this.exitHandler);
  }

  private unregisterExitCleanup(): void {
    if (!this.exitHandler) return;
    process.off('exit', this.exitHandler);
    this.exitHandler = null;
  }

  /** Single HTTP helper for both verbs — upstream duplicated this twice over. */
  private httpRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port ?? undefined,
          path,
          method,
          headers: payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : undefined,
          timeout: this.requestTimeoutMs,
        },
        res => {
          let responseBody = '';
          res.on('data', (chunk: Buffer) => {
            responseBody += chunk.toString();
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(responseBody) as T);
            } catch {
              reject(new Error(`Failed to parse response: ${responseBody.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', (err: Error) =>
        reject(new Error(`HTTP request to sqlglot server failed: ${err.message}`))
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request to ${path} timed out after ${this.requestTimeoutMs}ms`));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}
