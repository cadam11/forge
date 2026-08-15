import { table, getBorderCharacters } from 'table';
import chalk from 'chalk';

export type OutputFormat = 'table' | 'json' | 'csv';

export function formatResults(
  recordsets: Array<Record<string, unknown>[]>,
  format: OutputFormat = 'table'
): string {
  if (recordsets.length === 0 || recordsets[0].length === 0) {
    return chalk.yellow('No results returned.');
  }

  const results: string[] = [];

  recordsets.forEach((recordset, index) => {
    if (recordsets.length > 1) {
      results.push(chalk.cyan(`\n--- Result Set ${index + 1} ---\n`));
    }

    switch (format) {
      case 'json':
        results.push(formatAsJson(recordset));
        break;
      case 'csv':
        results.push(formatAsCsv(recordset));
        break;
      case 'table':
      default:
        results.push(formatAsTable(recordset));
    }

    results.push(chalk.dim(`(${recordset.length} row${recordset.length !== 1 ? 's' : ''})`));
  });

  return results.join('\n');
}

function formatAsTable(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  const columns = Object.keys(data[0]);
  const header = columns.map(col => chalk.bold.cyan(col));

  const rows = data.map(row =>
    columns.map(col => {
      const value = row[col];
      if (value === null) return chalk.dim('NULL');
      if (value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    })
  );

  const tableData = [header, ...rows];

  return table(tableData, {
    border: getBorderCharacters('norc'),
    columnDefault: {
      truncate: 50,
    },
    drawHorizontalLine: (lineIndex: number, rowCount: number) => {
      return lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount;
    },
  });
}

function formatAsJson(data: Record<string, unknown>[]): string {
  return JSON.stringify(data, null, 2);
}

function formatAsCsv(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  const columns = Object.keys(data[0]);
  const lines: string[] = [];

  // Header
  lines.push(columns.map(escapeCsvValue).join(','));

  // Data rows
  for (const row of data) {
    const values = columns.map(col => {
      const value = row[col];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return escapeCsvValue(JSON.stringify(value));
      return escapeCsvValue(String(value));
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function printSuccess(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function printError(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}
