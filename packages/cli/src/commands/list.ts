import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { table, getBorderCharacters } from 'table';
import {
  getDatabases,
  getTables,
  getViews,
  getProcedures,
  isConnected,
  formatError,
} from '../utils/database';
import { printError, printInfo } from '../utils/output';

export const listCommand = new Command('list')
  .alias('ls')
  .description('List databases, tables, or other objects')
  .argument('[type]', 'Type to list: databases, tables, views, procedures', 'databases')
  .option('-d, --database <name>', 'Database to use for tables/views/procedures')
  .action(async (type, options) => {
    if (!isConnected()) {
      printError('Not connected to a database.');
      printInfo('Use "joinery connect" to establish a connection first.');
      process.exit(1);
    }

    const spinner = ora(`Loading ${type}...`).start();

    try {
      switch (type.toLowerCase()) {
        case 'databases':
        case 'dbs':
        case 'db':
          await listDatabases(spinner);
          break;

        case 'tables':
        case 'tbl':
          await listTables(spinner, options.database);
          break;

        case 'views':
        case 'v':
          await listViews(spinner, options.database);
          break;

        case 'procedures':
        case 'procs':
        case 'sp':
          await listProcedures(spinner, options.database);
          break;

        default:
          spinner.fail(`Unknown type: ${type}`);
          printInfo('Valid types: databases, tables, views, procedures');
          process.exit(1);
      }
    } catch (error) {
      spinner.fail('Failed to load');
      printError(formatError(error));
      process.exit(1);
    }
  });

async function listDatabases(spinner: ReturnType<typeof ora>): Promise<void> {
  const databases = await getDatabases();
  spinner.succeed(`Found ${databases.length} databases`);
  console.log('');

  const tableData = [[chalk.bold.cyan('Database')], ...databases.map(db => [db])];

  console.log(
    table(tableData, {
      border: getBorderCharacters('norc'),
      drawHorizontalLine: (lineIndex: number, rowCount: number) =>
        lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
    })
  );
}

async function listTables(spinner: ReturnType<typeof ora>, database?: string): Promise<void> {
  const tables = await getTables(database);
  spinner.succeed(`Found ${tables.length} tables`);
  console.log('');

  if (tables.length === 0) {
    printInfo('No tables found');
    return;
  }

  const tableData = [
    [chalk.bold.cyan('Schema'), chalk.bold.cyan('Table')],
    ...tables.map(t => [t.schema, t.name]),
  ];

  console.log(
    table(tableData, {
      border: getBorderCharacters('norc'),
      drawHorizontalLine: (lineIndex: number, rowCount: number) =>
        lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
    })
  );
}

async function listViews(spinner: ReturnType<typeof ora>, database?: string): Promise<void> {
  const views = await getViews(database);
  spinner.succeed(`Found ${views.length} views`);
  console.log('');

  if (views.length === 0) {
    printInfo('No views found');
    return;
  }

  const tableData = [
    [chalk.bold.cyan('Schema'), chalk.bold.cyan('View')],
    ...views.map(v => [v.schema, v.name]),
  ];

  console.log(
    table(tableData, {
      border: getBorderCharacters('norc'),
      drawHorizontalLine: (lineIndex: number, rowCount: number) =>
        lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
    })
  );
}

async function listProcedures(spinner: ReturnType<typeof ora>, database?: string): Promise<void> {
  const procedures = await getProcedures(database);
  spinner.succeed(`Found ${procedures.length} stored procedures`);
  console.log('');

  if (procedures.length === 0) {
    printInfo('No stored procedures found');
    return;
  }

  const tableData = [
    [chalk.bold.cyan('Schema'), chalk.bold.cyan('Procedure')],
    ...procedures.map(p => [p.schema, p.name]),
  ];

  console.log(
    table(tableData, {
      border: getBorderCharacters('norc'),
      drawHorizontalLine: (lineIndex: number, rowCount: number) =>
        lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
    })
  );
}
