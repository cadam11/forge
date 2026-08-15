import { Command } from 'commander';
import chalk from 'chalk';
import { table, getBorderCharacters } from 'table';
import inquirer from 'inquirer';
import {
  loadConfig,
  saveConfig,
  listConnections,
  removeConnection,
  setDefaultConnection,
  type JoineryConfig,
} from '../utils/config';
import { printSuccess, printError, printInfo } from '../utils/output';

export const configCommand = new Command('config')
  .description('Manage CLI configuration')
  .addCommand(configListCommand())
  .addCommand(configSetCommand())
  .addCommand(configRemoveCommand())
  .addCommand(configDefaultCommand())
  .addCommand(configShowCommand());

function configListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List saved connections')
    .action(() => {
      const config = loadConfig();
      const connections = listConnections();

      if (connections.length === 0) {
        printInfo('No saved connections.');
        printInfo('Use "joinery connect --name <name>" to save a connection.');
        return;
      }

      console.log(chalk.cyan('\nSaved Connections:\n'));

      const tableData = [
        [
          chalk.bold.cyan('Name'),
          chalk.bold.cyan('Server'),
          chalk.bold.cyan('Database'),
          chalk.bold.cyan('Default'),
        ],
        ...connections.map(conn => [
          conn.name,
          `${conn.server}:${conn.port}`,
          conn.database || chalk.dim('(not set)'),
          conn.name === config.defaultConnection ? chalk.green('✓') : '',
        ]),
      ];

      console.log(
        table(tableData, {
          border: getBorderCharacters('norc'),
          drawHorizontalLine: (lineIndex: number, rowCount: number) =>
            lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
        })
      );
    });
}

function configSetCommand(): Command {
  return new Command('set')
    .description('Set a configuration option')
    .argument('<key>', 'Configuration key')
    .argument('<value>', 'Configuration value')
    .action((key, value) => {
      const config = loadConfig();

      switch (key) {
        case 'outputFormat':
        case 'format':
          if (!['table', 'json', 'csv'].includes(value)) {
            printError('Invalid format. Use: table, json, or csv');
            process.exit(1);
          }
          config.outputFormat = value as JoineryConfig['outputFormat'];
          printSuccess(`Output format set to: ${value}`);
          break;

        case 'maxRows': {
          const rows = parseInt(value, 10);
          if (isNaN(rows) || rows < 1) {
            printError('Invalid value. Must be a positive number.');
            process.exit(1);
          }
          config.maxRows = rows;
          printSuccess(`Max rows set to: ${rows}`);
          break;
        }

        default:
          printError(`Unknown configuration key: ${key}`);
          printInfo('Valid keys: outputFormat, maxRows');
          process.exit(1);
      }

      saveConfig(config);
    });
}

function configRemoveCommand(): Command {
  return new Command('remove')
    .alias('rm')
    .alias('delete')
    .description('Remove a saved connection')
    .argument('<name>', 'Connection name')
    .option('-f, --force', 'Skip confirmation')
    .action(async (name, options) => {
      const config = loadConfig();

      if (!config.connections[name]) {
        printError(`Connection "${name}" not found.`);
        process.exit(1);
      }

      if (!options.force) {
        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Delete connection "${name}"?`,
            default: false,
          },
        ]);

        if (!answers.confirm) {
          printInfo('Cancelled');
          return;
        }
      }

      if (removeConnection(name)) {
        printSuccess(`Connection "${name}" removed.`);
      } else {
        printError('Failed to remove connection.');
      }
    });
}

function configDefaultCommand(): Command {
  return new Command('default')
    .description('Set the default connection')
    .argument('<name>', 'Connection name')
    .action(name => {
      if (setDefaultConnection(name)) {
        printSuccess(`Default connection set to: ${name}`);
      } else {
        printError(`Connection "${name}" not found.`);
        process.exit(1);
      }
    });
}

function configShowCommand(): Command {
  return new Command('show').description('Show current configuration').action(() => {
    const config = loadConfig();

    console.log(chalk.cyan('\nConfiguration:\n'));
    console.log(`  ${chalk.bold('Output Format:')}    ${config.outputFormat}`);
    console.log(`  ${chalk.bold('Max Rows:')}         ${config.maxRows}`);
    console.log(
      `  ${chalk.bold('Default Connection:')} ${config.defaultConnection || chalk.dim('(not set)')}`
    );
    console.log(`  ${chalk.bold('Saved Connections:')} ${Object.keys(config.connections).length}`);
    console.log('');
  });
}
