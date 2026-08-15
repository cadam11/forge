/**
 * Types for the backup/restore CLI dependency check.
 *
 * Joinery's PG and MySQL backup services shell out to the host-installed
 * `pg_dump` / `pg_restore` / `mysqldump` / `mysql` binaries (they aren't
 * bundled with the app — see CLAUDE.md for the rationale). The renderer
 * checks for the right binaries before showing the backup/restore form;
 * if anything's missing it shows a setup-instructions view sourced from
 * the install-instructions config in this package.
 */

export type CliEngine = 'postgresql' | 'mysql';

/**
 * The platforms we ship setup instructions for. macOS and Windows are
 * the only Joinery build targets in `electron-builder.yml`. Linux + others
 * fall through to a generic instruction block — see
 * `cli-install-instructions.ts`.
 */
export type CliInstructionsPlatform = 'darwin' | 'win32';

/** One CLI tool's per-host probe result. */
export interface CliToolStatus {
  tool: string;
  available: boolean;
  /** First line of `<tool> --version` output, when available. */
  version?: string;
}

/**
 * One step the user takes to install the missing tools. A step is one of:
 * a description-only line, a description + shell command, or a description
 * + an external link to a download page.
 */
export interface CliInstallStep {
  description: string;
  command?: string;
  link?: { url: string; label: string };
}

export interface CliInstallInstructions {
  engine: CliEngine;
  /** The platform the steps are written for. `'generic'` for the fallback. */
  platform: CliInstructionsPlatform | 'generic';
  title: string;
  steps: CliInstallStep[];
  notes?: string[];
}

export interface CliDepsResult {
  engine: CliEngine;
  /** Raw `process.platform` string from the main process. */
  platform: string;
  tools: CliToolStatus[];
  allAvailable: boolean;
  /** Populated when `allAvailable` is false. */
  installInstructions?: CliInstallInstructions;
}
