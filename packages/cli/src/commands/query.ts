import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as readline from 'readline';
import { executeQuery, isConnected, formatError } from '../utils/database';
import { formatResults, printError, printInfo, type OutputFormat } from '../utils/output';
import { loadConfig } from '../utils/config';

export const queryCommand = new Command('query')
  .alias('q')
  .description('Execute a SQL query')
  .argument('[sql]', 'SQL query to execute')
  .option('-f, --format <format>', 'Output format: table, json, csv', 'table')
  .option('-m, --max-rows <rows>', 'Maximum rows to return')
  .option('-i, --interactive', 'Start interactive query mode')
  .action(async (sql, options) => {
    if (!isConnected()) {
      printError('Not connected to a database.');
      printInfo('Use "joinery connect" to establish a connection first.');
      process.exit(1);
    }

    const config = loadConfig();
    const format = (options.format || config.outputFormat) as OutputFormat;
    const maxRows = options.maxRows ? parseInt(options.maxRows, 10) : config.maxRows;

    if (options.interactive) {
      await interactiveMode(format, maxRows);
      return;
    }

    if (!sql) {
      // Prompt for query if not provided
      const answers = await inquirer.prompt([
        {
          type: 'editor',
          name: 'sql',
          message: 'Enter SQL query:',
        },
      ]);
      sql = answers.sql;
    }

    await runQuery(sql, format, maxRows);
  });

async function runQuery(sql: string, format: OutputFormat, maxRows: number): Promise<void> {
  const spinner = ora('Executing query...').start();
  const startTime = Date.now();

  try {
    const results = await executeQuery(sql, maxRows);
    const elapsed = Date.now() - startTime;

    spinner.succeed(`Query completed in ${elapsed}ms`);
    console.log('');

    const output = formatResults(results as Record<string, unknown>[][], format);
    console.log(output);
  } catch (error) {
    spinner.fail('Query failed');
    printError(formatError(error));
    process.exit(1);
  }
}

async function interactiveMode(defaultFormat: OutputFormat, maxRows: number): Promise<void> {
  console.log(chalk.cyan('\n📊 Interactive SQL Mode'));
  console.log(chalk.dim('Type SQL queries and press Enter to execute.'));
  console.log(chalk.dim('Commands: .exit, .format [table|json|csv], .clear\n'));

  let format = defaultFormat;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('sql> '),
  });

  let buffer = '';

  rl.prompt();

  rl.on('line', async line => {
    const trimmed = line.trim();

    // Handle special commands
    if (trimmed.startsWith('.')) {
      const [cmd, ...args] = trimmed.slice(1).split(' ');

      switch (cmd.toLowerCase()) {
        case 'exit':
        case 'quit':
        case 'q':
          console.log(chalk.dim('Goodbye!'));
          rl.close();
          process.exit(0);
          break;

        case 'format':
          if (args[0] && ['table', 'json', 'csv'].includes(args[0])) {
            format = args[0] as OutputFormat;
            console.log(chalk.dim(`Output format set to: ${format}`));
          } else {
            console.log(chalk.dim(`Current format: ${format}`));
            console.log(chalk.dim('Usage: .format [table|json|csv]'));
          }
          break;

        case 'clear':
          console.clear();
          break;

        case 'help':
          console.log(
            chalk.dim(`
Commands:
  .exit, .quit, .q  - Exit interactive mode
  .format <fmt>     - Set output format (table, json, csv)
  .clear            - Clear screen
  .help             - Show this help
          `)
          );
          break;

        default:
          console.log(chalk.yellow(`Unknown command: .${cmd}`));
      }

      rl.prompt();
      return;
    }

    // Accumulate multi-line queries
    buffer += line + '\n';

    // Execute if line ends with semicolon or is empty (after content)
    if (trimmed.endsWith(';') || (buffer.trim().length > 0 && trimmed === '')) {
      const query = buffer.trim();
      buffer = '';

      if (query) {
        // Remove trailing semicolon if present
        const cleanQuery = query.endsWith(';') ? query.slice(0, -1) : query;

        console.log('');
        const spinner = ora('Executing...').start();
        const startTime = Date.now();

        try {
          const results = await executeQuery(cleanQuery, maxRows);
          const elapsed = Date.now() - startTime;

          spinner.succeed(`Completed in ${elapsed}ms`);
          const output = formatResults(results as Record<string, unknown>[][], format);
          console.log(output);
        } catch (error) {
          spinner.fail('Failed');
          printError(formatError(error));
        }

        console.log('');
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
