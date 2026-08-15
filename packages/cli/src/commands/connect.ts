import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { connect, getConnectionInfo, formatError } from '../utils/database';
import {
  saveConnection,
  getConnection,
  setDefaultConnection,
  type ConnectionConfig,
} from '../utils/config';
import { printSuccess, printError, printInfo } from '../utils/output';

interface ConnectPromptAnswers {
  server: string;
  port: string;
  database: string;
  user: string;
  password: string;
  trustCert: boolean;
  save: boolean;
  name: string;
}

export const connectCommand = new Command('connect')
  .description('Connect to a SQL Server instance')
  .option('-s, --server <server>', 'Server hostname or IP')
  .option('-p, --port <port>', 'Server port (default: 1433)', '1433')
  .option('-d, --database <database>', 'Database name')
  .option('-u, --user <user>', 'Username')
  .option('-P, --password <password>', 'Password')
  .option('-n, --name <name>', 'Save connection with this name')
  .option('-c, --connection <name>', 'Use saved connection')
  .option('--trust-cert', 'Trust server certificate', false)
  .option('--no-encrypt', 'Disable encryption')
  .action(async options => {
    try {
      let config: ConnectionConfig;

      // Use saved connection if specified
      if (options.connection) {
        const saved = getConnection(options.connection);
        if (!saved) {
          printError(`Connection "${options.connection}" not found.`);
          printInfo('Use "joinery config list" to see saved connections.');
          process.exit(1);
        }
        config = saved;
      } else if (options.server) {
        // Build config from options
        const port = parseInt(options.port, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          printError(`Invalid port number: ${options.port}. Must be 1-65535.`);
          process.exit(1);
        }
        config = {
          name: options.name || options.server,
          server: options.server,
          port,
          database: options.database,
          user: options.user,
          password: options.password,
          trustServerCertificate: options.trustCert,
          encrypt: options.encrypt !== false,
        };
      } else {
        // Interactive mode
        const answers = (await inquirer.prompt([
          {
            type: 'input',
            name: 'server',
            message: 'Server hostname:',
            validate: (input: string) => input.length > 0 || 'Server is required',
          },
          {
            type: 'input',
            name: 'port',
            message: 'Port:',
            default: '1433',
            validate: (input: string) => {
              const n = parseInt(input, 10);
              if (isNaN(n) || n < 1 || n > 65535) return 'Port must be 1-65535';
              return true;
            },
          },
          {
            type: 'input',
            name: 'database',
            message: 'Database (optional):',
          },
          {
            type: 'input',
            name: 'user',
            message: 'Username (optional, for SQL auth):',
          },
          {
            type: 'password',
            name: 'password',
            message: 'Password:',
            when: (prevAnswers: Partial<ConnectPromptAnswers>) => !!prevAnswers.user,
          },
          {
            type: 'confirm',
            name: 'trustCert',
            message: 'Trust server certificate?',
            default: true,
          },
          {
            type: 'confirm',
            name: 'save',
            message: 'Save this connection?',
            default: false,
          },
          {
            type: 'input',
            name: 'name',
            message: 'Connection name:',
            when: (prevAnswers: Partial<ConnectPromptAnswers>) => prevAnswers.save,
            validate: (input: string) => input.length > 0 || 'Name is required',
          },
        ])) as ConnectPromptAnswers;

        config = {
          name: answers.name || answers.server,
          server: answers.server,
          port: parseInt(answers.port, 10),
          database: answers.database || undefined,
          user: answers.user || undefined,
          password: answers.password || undefined,
          trustServerCertificate: answers.trustCert,
          encrypt: options.encrypt !== false,
        };

        if (answers.save && answers.name) {
          saveConnection(answers.name, config);
          setDefaultConnection(answers.name);
          printSuccess(`Connection saved as "${answers.name}" (default)`);
        }
      }

      const spinner = ora('Connecting to SQL Server...').start();

      try {
        await connect(config);
        const info = await getConnectionInfo();
        spinner.succeed('Connected!');

        console.log('');
        console.log(chalk.cyan('  Server:   '), info.server);
        console.log(chalk.cyan('  Version:  '), info.version);
        console.log(chalk.cyan('  Database: '), info.database);
        console.log('');

        // Save connection if name provided
        if (options.name) {
          saveConnection(options.name, config);
          setDefaultConnection(options.name);
          printSuccess(`Connection saved as "${options.name}" (default)`);
        }
      } catch (error) {
        spinner.fail('Connection failed');
        printError(formatError(error));
        process.exit(1);
      }
    } catch (error) {
      printError(formatError(error));
      process.exit(1);
    }
  });
