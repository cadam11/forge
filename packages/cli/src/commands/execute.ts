import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { executeQuery, isConnected, formatError } from '../utils/database';
import {
  formatResults,
  printError,
  printSuccess,
  printInfo,
  type OutputFormat,
} from '../utils/output';
import { loadConfig } from '../utils/config';

export const executeCommand = new Command('execute')
  .alias('exec')
  .alias('run')
  .description('Execute a SQL file')
  .argument('<file>', 'SQL file to execute')
  .option('-f, --format <format>', 'Output format: table, json, csv', 'table')
  .option('-o, --output <file>', 'Write results to file')
  .option('-m, --max-rows <rows>', 'Maximum rows to return')
  .option('--dry-run', 'Show query without executing')
  .action(async (file, options) => {
    // Validate file exists
    const filePath = path.resolve(file);

    if (!fs.existsSync(filePath)) {
      printError(`File not found: ${filePath}`);
      process.exit(1);
    }

    // Read file content
    let sql: string;
    try {
      sql = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      printError(`Failed to read file: ${formatError(error)}`);
      process.exit(1);
    }

    if (!sql.trim()) {
      printError('File is empty');
      process.exit(1);
    }

    // Dry run - just show the query
    if (options.dryRun) {
      console.log(chalk.cyan('\n--- SQL Query ---\n'));
      console.log(sql);
      console.log(chalk.cyan('\n--- End Query ---\n'));
      printInfo('Dry run mode - query not executed');
      return;
    }

    if (!isConnected()) {
      printError('Not connected to a database.');
      printInfo('Use "joinery connect" to establish a connection first.');
      process.exit(1);
    }

    const config = loadConfig();
    const format = (options.format || config.outputFormat) as OutputFormat;
    const maxRows = options.maxRows ? parseInt(options.maxRows, 10) : config.maxRows;

    const spinner = ora(`Executing ${path.basename(filePath)}...`).start();
    const startTime = Date.now();

    try {
      const results = await executeQuery(sql, maxRows);
      const elapsed = Date.now() - startTime;

      spinner.succeed(`Executed in ${elapsed}ms`);
      console.log('');

      const output = formatResults(results as Record<string, unknown>[][], format);

      // Write to file if specified
      if (options.output) {
        const outputPath = path.resolve(options.output);
        try {
          fs.writeFileSync(outputPath, output);
          printSuccess(`Results written to: ${outputPath}`);
        } catch (error) {
          printError(`Failed to write output: ${formatError(error)}`);
        }
      } else {
        console.log(output);
      }
    } catch (error) {
      spinner.fail('Execution failed');
      printError(formatError(error));
      process.exit(1);
    }
  });
