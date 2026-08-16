/**
 * The engine option matrix, the T-SQL transcription, and the phase machine.
 *
 * These are the assertions that make the four dropped Angular controls a *decision* rather than an
 * omission: the matrix is asserted per engine, and the T-SQL is asserted clause-for-clause against
 * what `packages/main/src/utils/tsql-builder.ts` emits — which is the whole reason the preview may be
 * trusted at all (CLAUDE.md's SQL-transparency rule). See `backup-model.ts`'s header for the four
 * gaps.
 */

import { describe, expect, it } from 'vitest';
import type { BackupProgress, CliDepsResult, DatabaseEngine } from '@joinery/shared';

import {
  BACKUP_TYPES,
  applyProgress,
  backupTsql,
  cliEngineFor,
  defaultBackupValues,
  derivePhase,
  destinationIsServerSide,
  engineBackupOptions,
  fileStamp,
  formatBytes,
  phaseForToolsResult,
  progressLabel,
  progressPercent,
  suggestedFileName,
  type BackupFormValues,
  type BackupPhase,
} from './backup-model';

const ENGINES: readonly DatabaseEngine[] = ['mssql', 'postgresql', 'mysql'];

function values(overrides: Partial<BackupFormValues> = {}): BackupFormValues {
  return { ...defaultBackupValues('mssql'), backupPath: 'C:\\Backups\\sales.bak', ...overrides };
}

function progress(overrides: Partial<BackupProgress> = {}): BackupProgress {
  return { backupId: 'op-1', status: 'running', percentComplete: 42, ...overrides };
}

function depsResult(overrides: Partial<CliDepsResult> = {}): CliDepsResult {
  return {
    engine: 'postgresql',
    platform: 'darwin',
    tools: [{ tool: 'pg_dump', available: true, version: '16.1' }],
    allAvailable: true,
    ...overrides,
  };
}

describe('which engines need host tools', () => {
  it('probes PG and MySQL and never MSSQL', () => {
    expect(cliEngineFor('postgresql')).toBe('postgresql');
    expect(cliEngineFor('mysql')).toBe('mysql');
    // `BACKUP DATABASE` runs inside the server, so there is nothing on this machine to probe — which
    // is also why `CliEngine` has only two members.
    expect(cliEngineFor('mssql')).toBeNull();
  });

  it('puts the destination on the server for MSSQL only', () => {
    expect(destinationIsServerSide('mssql')).toBe(true);
    expect(destinationIsServerSide('postgresql')).toBe(false);
    expect(destinationIsServerSide('mysql')).toBe(false);
  });
});

describe('the engine option matrix', () => {
  it('offers the four MSSQL-only surfaces to MSSQL alone', () => {
    const mssql = engineBackupOptions('mssql');
    expect(mssql.showBackupType).toBe(true);
    expect(mssql.showCompression).toBe(true);
    expect(mssql.showDescription).toBe(true);
    expect(mssql.showTsqlPreview).toBe(true);
    expect(mssql.showHistory).toBe(true);
  });

  it('offers PG and MySQL no options at all, and states the format instead', () => {
    // Gap 1 in the model's header: `pg-backup.ts` hard-codes `-F c` and `mysql-backup.ts` never reads
    // `backupType`, so a format picker on these engines is a control that cannot change the output.
    for (const engine of ['postgresql', 'mysql'] as const) {
      const options = engineBackupOptions(engine);
      expect(options.showBackupType).toBe(false);
      expect(options.showCompression).toBe(false);
      expect(options.showDescription).toBe(false);
      expect(options.showTsqlPreview).toBe(false);
      expect(options.showHistory).toBe(false);
      // What is offered instead: a statement of what the format IS.
      expect(options.formatNote).not.toBeNull();
    }
    expect(engineBackupOptions('postgresql').formatNote).toMatch(/pg_dump/);
    expect(engineBackupOptions('mysql').formatNote).toMatch(/mysqldump/);
    // MSSQL has a picker, so it needs no note.
    expect(engineBackupOptions('mssql').formatNote).toBeNull();
  });

  it('never shows a history panel for an engine whose history is always empty', () => {
    // `backup.ipc.ts:125-128` answers `[]` for PG and MySQL. Gating on the engine rather than on the
    // list keeps an empty panel off the screen instead of explaining itself.
    for (const engine of ENGINES) {
      expect(engineBackupOptions(engine).showHistory).toBe(engine === 'mssql');
    }
  });

  it('gives every engine a path label, a placeholder and an extension', () => {
    for (const engine of ENGINES) {
      const options = engineBackupOptions(engine);
      expect(options.pathLabel.length).toBeGreaterThan(0);
      expect(options.pathPlaceholder.length).toBeGreaterThan(0);
      expect(options.extension).toMatch(/^[a-z]+$/);
    }
    expect(engineBackupOptions('mssql').extension).toBe('bak');
    expect(engineBackupOptions('postgresql').extension).toBe('dump');
    expect(engineBackupOptions('mysql').extension).toBe('sql');
  });

  it('offers only the two backup types the T-SQL builder honours', () => {
    // Gap 4: `backupType: 'log'` fell through both arms of `tsql-builder.ts:126-130` and ran a FULL
    // backup under a label promising a log backup. This is the assertion that keeps it out.
    expect(BACKUP_TYPES.map(type => type.value)).toEqual(['full', 'differential']);
    expect(BACKUP_TYPES.map(type => type.value)).not.toContain('log');
  });

  it('defaults compression on where it exists and off where it does not', () => {
    expect(defaultBackupValues('mssql')).toEqual({
      backupType: 'full',
      backupPath: '',
      description: '',
      compression: true,
    });
    expect(defaultBackupValues('postgresql').compression).toBe(false);
  });
});

describe('the suggested file name', () => {
  const NOW = new Date('2026-08-16T14:32:05.123Z');

  it('is colon-free, so it is legal in a Windows path', () => {
    expect(fileStamp(NOW)).toBe('2026-08-16T14-32-05');
    expect(fileStamp(NOW)).not.toContain(':');
  });

  it('carries the second, so two backups on one day cannot collide', () => {
    // The MSSQL path is written `WITH INIT`, which overwrites — a date-only stamp would make the
    // second backup of a day destroy the first.
    const later = new Date('2026-08-16T14:32:06.000Z');
    expect(suggestedFileName('sales', 'mssql', NOW)).not.toBe(
      suggestedFileName('sales', 'mssql', later)
    );
  });

  it('uses the engine’s own extension', () => {
    expect(suggestedFileName('sales', 'mssql', NOW)).toBe('sales_2026-08-16T14-32-05.bak');
    expect(suggestedFileName('sales', 'postgresql', NOW)).toBe('sales_2026-08-16T14-32-05.dump');
    expect(suggestedFileName('sales', 'mysql', NOW)).toBe('sales_2026-08-16T14-32-05.sql');
  });
});

describe('the T-SQL preview', () => {
  it('is the statement the main process runs, INIT and STATS included', () => {
    // Transcribed from `TsqlBuilder.backup`. `INIT` is why a repeated path overwrites rather than
    // appends and `STATS = 5` is why the server reports a percentage at all; the Angular preview
    // omitted both, so it described a statement nobody executed.
    expect(backupTsql(values(), 'sales')).toBe(
      "BACKUP DATABASE [sales]\nTO DISK = N'C:\\Backups\\sales.bak'\nWITH INIT, COMPRESSION, STATS = 5;"
    );
  });

  it('puts DIFFERENTIAL first, in the builder’s own order', () => {
    expect(backupTsql(values({ backupType: 'differential' }), 'sales')).toContain(
      'WITH DIFFERENTIAL, INIT, COMPRESSION, STATS = 5;'
    );
  });

  it('drops COMPRESSION when the box is clear', () => {
    expect(backupTsql(values({ compression: false }), 'sales')).toContain('WITH INIT, STATS = 5;');
  });

  it('emits DESCRIPTION only when there is one, before STATS', () => {
    expect(backupTsql(values({ description: 'nightly' }), 'sales')).toContain(
      "WITH INIT, COMPRESSION, DESCRIPTION = N'nightly', STATS = 5;"
    );
    expect(backupTsql(values(), 'sales')).not.toContain('DESCRIPTION');
  });

  it('never emits a clause the builder cannot produce', () => {
    // Gaps 2 and 3: `BackupRequest.copyOnly` is read by nothing, and `checksum` becomes a `verify`
    // that `TsqlBuilder.backup` ignores. The Angular preview showed both.
    const sql = backupTsql(values({ description: "it's nightly" }), 'sales');
    expect(sql).not.toContain('COPY_ONLY');
    expect(sql).not.toContain('CHECKSUM');
  });

  it('escapes the identifier and the two string literals the way the builder does', () => {
    const sql = backupTsql(
      values({ backupPath: "C:\\it's\\db.bak", description: "o'clock" }),
      'we]ird'
    );
    expect(sql).toContain('BACKUP DATABASE [we]]ird]');
    expect(sql).toContain("TO DISK = N'C:\\it''s\\db.bak'");
    expect(sql).toContain("DESCRIPTION = N'o''clock'");
  });

  it('shows a placeholder rather than an empty literal before a path is chosen', () => {
    expect(backupTsql(values({ backupPath: '' }), 'sales')).toContain("TO DISK = N'<path>'");
  });
});

describe('formatBytes', () => {
  it('names each unit, and keeps one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3 TB');
  });

  it('answers 0 B for a negative or non-finite size rather than NaN', () => {
    // `Math.log(0)` is `-Infinity` and `Math.log(-1)` is `NaN`; the Angular version indexed
    // `sizes[i]` with both and rendered `undefined`.
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });

  it('clamps past the largest unit it knows', () => {
    expect(formatBytes(1024 ** 7)).toMatch(/PB$/);
  });
});

describe('the phase the probe implies', () => {
  it('opens MSSQL straight on the form, with no probe at all', () => {
    expect(derivePhase('mssql', { result: undefined, failed: false })).toEqual({ kind: 'options' });
  });

  it('holds PG and MySQL on the spinner until the probe answers', () => {
    expect(derivePhase('postgresql', { result: undefined, failed: false })).toEqual({
      kind: 'checking',
    });
  });

  it('shows the remediation view when a tool is missing', () => {
    const result = depsResult({
      allAvailable: false,
      tools: [{ tool: 'pg_dump', available: false }],
    });
    expect(derivePhase('postgresql', { result, failed: false })).toEqual({
      kind: 'tools-missing',
      result,
    });
  });

  it('opens the form when the probe itself failed', () => {
    // Failing to ASK is not being told no. The tools may well be there, the attempt is the user's, and
    // the reason is stated above the button rather than blocking it.
    expect(derivePhase('postgresql', { result: undefined, failed: true })).toEqual({
      kind: 'options',
    });
  });

  it('treats a passing probe as the form', () => {
    expect(phaseForToolsResult(depsResult())).toEqual({ kind: 'options' });
  });
});

describe('applyProgress', () => {
  const running: BackupPhase = {
    kind: 'running',
    path: '/tmp/sales.dump',
    backupId: null,
    progress: null,
  };

  it('binds the operation id from the first event', () => {
    // `backup.start` is typed `Promise<void>` in preload and PG/MySQL mint their own uuid regardless of
    // `BackupRequest.backupId`, so the event is the only honest source of the id.
    const next = applyProgress(running, progress({ backupId: 'op-9' }));
    expect(next).toEqual({
      kind: 'running',
      path: '/tmp/sales.dump',
      backupId: 'op-9',
      progress: progress({ backupId: 'op-9' }),
    });
  });

  it('ignores an event for a different operation once an id is bound', () => {
    const bound: BackupPhase = { ...running, backupId: 'op-1' };
    const next = applyProgress(bound, progress({ backupId: 'op-2', status: 'completed' }));
    // The same object, so the caller's unconditional `setState` costs no render.
    expect(next).toBe(bound);
  });

  it('ignores every event while no backup of ours is running', () => {
    for (const phase of [
      { kind: 'options' } as const,
      { kind: 'checking' } as const,
      { kind: 'done', path: '/tmp/x' } as const,
      { kind: 'failed', message: 'no' } as const,
    ]) {
      expect(applyProgress(phase, progress({ status: 'completed' }))).toBe(phase);
    }
  });

  it('lands on the success state carrying the path it started with', () => {
    const next = applyProgress(running, progress({ status: 'completed', elapsedMs: 4200 }));
    expect(next).toEqual({ kind: 'done', path: '/tmp/sales.dump', elapsedMs: 4200 });
  });

  it('omits the elapsed time rather than inventing a zero', () => {
    expect(applyProgress(running, progress({ status: 'completed' }))).toEqual({
      kind: 'done',
      path: '/tmp/sales.dump',
    });
  });

  it('carries the engine’s own error text into the failure state', () => {
    expect(
      applyProgress(running, progress({ status: 'failed', error: 'pg_dump: no such db' }))
    ).toEqual({ kind: 'failed', message: 'pg_dump: no such db' });
  });

  it('states a failure even when the engine sent no message', () => {
    // The Angular dialog passed `p.error` straight to a toast, so a failure with no message produced
    // `undefined` in a snackbar that a modal made inert anyway.
    expect(applyProgress(running, progress({ status: 'failed' }))).toEqual({
      kind: 'failed',
      message: 'The backup failed.',
    });
  });

  it('treats a cancellation as a stated, recoverable failure', () => {
    expect(applyProgress(running, progress({ status: 'cancelled' }))).toEqual({
      kind: 'failed',
      message: 'The backup was cancelled.',
    });
  });
});

describe('the progress readout', () => {
  it('is indeterminate before the first event', () => {
    expect(progressPercent(null)).toBeNull();
    expect(progressLabel(null)).toBe('Starting the backup…');
  });

  it('reads the CLI engines’ -1 as indeterminate, not as zero', () => {
    // `pg-backup.ts:296` reports -1 on purpose. Angular painted it as `0%`, which reads as stalled.
    expect(progressPercent(progress({ percentComplete: -1 }))).toBeNull();
  });

  it('rounds and clamps a real percentage', () => {
    expect(progressPercent(progress({ percentComplete: 42.4 }))).toBe(42);
    expect(progressPercent(progress({ percentComplete: 140 }))).toBe(100);
    expect(progressPercent(progress({ percentComplete: Number.NaN }))).toBeNull();
  });

  it('prefers the engine’s phase line, and is never empty', () => {
    expect(progressLabel(progress({ currentPhase: 'Dumping public.orders' }))).toBe(
      'Dumping public.orders'
    );
    expect(progressLabel(progress({ currentPhase: '   ' }))).toBe('Backing up…');
    expect(progressLabel(progress({ status: 'starting', currentPhase: '' }))).toBe(
      'Starting the backup…'
    );
  });
});
