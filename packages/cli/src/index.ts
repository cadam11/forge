#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { connectCommand } from './commands/connect';
import { queryCommand } from './commands/query';
import { executeCommand } from './commands/execute';
import { listCommand } from './commands/list';
import { configCommand } from './commands/config';

const program = new Command();

program
  .name('joinery')
  .description('Joinery CLI - SQL Server management from the command line')
  .version('0.1.0');

// Add commands
program.addCommand(connectCommand);
program.addCommand(queryCommand);
program.addCommand(executeCommand);
program.addCommand(listCommand);
program.addCommand(configCommand);

// Default action - show help
program.action(() => {
  console.log(
    chalk.cyan(`
  ╔═══════════════════════════════════════════╗
  ║           ${chalk.bold('Joinery CLI')}                       ║
  ║     SQL Server Management Tool            ║
  ╚═══════════════════════════════════════════╝
  `)
  );
  program.help();
});

// Handle errors
program.exitOverride();

try {
  program.parse();
} catch (error: unknown) {
  if (error instanceof Error && (error as { code?: string }).code !== 'commander.help') {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}
