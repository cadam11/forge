/**
 * Per-platform install instructions for the host-side backup/restore CLIs.
 *
 * Surfaced by the renderer's missing-cli-tools view when the deps probe
 * reports a missing binary. Kept in `shared` so both main (for IPC type
 * safety) and renderer (for rendering) consume the same source.
 *
 * Joinery ships macOS + Windows installers (see `electron-builder.yml`).
 * Linux/other platforms get a generic block that points at the official
 * docs without a copy-pasteable command.
 */

import type {
  CliEngine,
  CliInstallInstructions,
  CliInstructionsPlatform,
} from '../types/cli-deps.types';

const POSTGRES_DARWIN: CliInstallInstructions = {
  engine: 'postgresql',
  platform: 'darwin',
  title: 'Install PostgreSQL client tools',
  steps: [
    {
      description: 'Install the PostgreSQL 16 client suite via Homebrew.',
      command: 'brew install postgresql@16',
    },
    {
      description: 'Make pg_dump and pg_restore available on PATH.',
      command: 'brew link --force postgresql@16',
    },
    {
      description: 'Verify the installation.',
      command: 'pg_dump --version',
    },
  ],
  notes: [
    'Restart Joinery after installing so the new PATH is picked up.',
    "Don't have Homebrew? Install it first from https://brew.sh.",
  ],
};

const POSTGRES_WIN32: CliInstallInstructions = {
  engine: 'postgresql',
  platform: 'win32',
  title: 'Install PostgreSQL client tools',
  steps: [
    {
      description: 'Download the PostgreSQL installer from the official site.',
      link: {
        url: 'https://www.postgresql.org/download/windows/',
        label: 'PostgreSQL for Windows',
      },
    },
    {
      description:
        'Run the installer. You only need the "Command Line Tools" component — the server install is optional.',
    },
    {
      description: 'Open a new Command Prompt or PowerShell window and verify.',
      command: 'pg_dump --version',
    },
  ],
  notes: [
    'Restart Joinery after installing so the new PATH is picked up.',
    "If pg_dump still isn't found, ensure the PostgreSQL bin folder (typically C:\\Program Files\\PostgreSQL\\16\\bin) is on your PATH.",
  ],
};

const MYSQL_DARWIN: CliInstallInstructions = {
  engine: 'mysql',
  platform: 'darwin',
  title: 'Install MySQL client tools',
  steps: [
    {
      description: 'Install the MySQL client (mysqldump + mysql) via Homebrew.',
      command: 'brew install mysql-client',
    },
    {
      description:
        'mysql-client is keg-only — add its bin folder to your shell PATH so Joinery can find it.',
      command: 'echo \'export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"\' >> ~/.zshrc',
    },
    {
      description: 'Reload your shell, then verify.',
      command: 'source ~/.zshrc && mysqldump --version',
    },
  ],
  notes: [
    'Restart Joinery after installing so the new PATH is picked up.',
    'If you use bash instead of zsh, swap ~/.zshrc for ~/.bash_profile.',
    "Don't have Homebrew? Install it first from https://brew.sh.",
  ],
};

const MYSQL_WIN32: CliInstallInstructions = {
  engine: 'mysql',
  platform: 'win32',
  title: 'Install MySQL client tools',
  steps: [
    {
      description: 'Download the MySQL installer from the official site.',
      link: {
        url: 'https://dev.mysql.com/downloads/installer/',
        label: 'MySQL Installer for Windows',
      },
    },
    {
      description:
        'Run the installer and select "MySQL Shell" + "Client only" — you do not need the full server.',
    },
    {
      description: 'Open a new Command Prompt or PowerShell window and verify.',
      command: 'mysqldump --version',
    },
  ],
  notes: [
    'Restart Joinery after installing so the new PATH is picked up.',
    "If mysqldump still isn't found, ensure the MySQL bin folder is on your PATH.",
  ],
};

const POSTGRES_GENERIC: CliInstallInstructions = {
  engine: 'postgresql',
  platform: 'generic',
  title: 'Install PostgreSQL client tools',
  steps: [
    {
      description:
        "Install the PostgreSQL 16 client suite (pg_dump, pg_restore) using your platform's package manager.",
    },
    {
      description: 'See the official PostgreSQL download page for platform-specific instructions.',
      link: {
        url: 'https://www.postgresql.org/download/',
        label: 'PostgreSQL Downloads',
      },
    },
    {
      description: 'Verify pg_dump is on PATH after install.',
      command: 'pg_dump --version',
    },
  ],
  notes: ['Restart Joinery after installing so the new PATH is picked up.'],
};

const MYSQL_GENERIC: CliInstallInstructions = {
  engine: 'mysql',
  platform: 'generic',
  title: 'Install MySQL client tools',
  steps: [
    {
      description:
        "Install the MySQL client tools (mysqldump, mysql) using your platform's package manager.",
    },
    {
      description: 'See the official MySQL download page for platform-specific instructions.',
      link: { url: 'https://dev.mysql.com/downloads/', label: 'MySQL Downloads' },
    },
    {
      description: 'Verify mysqldump is on PATH after install.',
      command: 'mysqldump --version',
    },
  ],
  notes: ['Restart Joinery after installing so the new PATH is picked up.'],
};

const SUPPORTED: Record<CliEngine, Record<CliInstructionsPlatform, CliInstallInstructions>> = {
  postgresql: { darwin: POSTGRES_DARWIN, win32: POSTGRES_WIN32 },
  mysql: { darwin: MYSQL_DARWIN, win32: MYSQL_WIN32 },
};

const GENERIC: Record<CliEngine, CliInstallInstructions> = {
  postgresql: POSTGRES_GENERIC,
  mysql: MYSQL_GENERIC,
};

/**
 * Resolve the install instructions block for a given engine + platform.
 * Falls back to the generic block when the platform isn't one of the
 * Joinery build targets (macOS or Windows).
 */
export function getCliInstallInstructions(
  engine: CliEngine,
  platform: string
): CliInstallInstructions {
  if (platform === 'darwin' || platform === 'win32') {
    return SUPPORTED[engine][platform];
  }
  return GENERIC[engine];
}
