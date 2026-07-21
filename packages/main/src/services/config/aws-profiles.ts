/**
 * AWS profile discovery for the connection dialog's aws-iam auth picker.
 * Pure parsing is separated from fs so it's unit-testable. We only need
 * section NAMES — credential resolution itself is the connector's job.
 *
 * ~/.aws/config uses "[profile name]" (except "[default]");
 * ~/.aws/credentials uses bare "[name]".
 */
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../../utils/logger';

const log = createLogger('AwsProfiles');

const NON_PROFILE_PREFIXES = ['sso-session ', 'services '];

function sectionNames(text: string, stripProfilePrefix: boolean): string[] {
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^\[([^\]]+)\]$/.exec(line.trim());
    if (!match) continue;
    let name = match[1].trim();
    if (stripProfilePrefix) {
      if (NON_PROFILE_PREFIXES.some(p => name.startsWith(p))) continue;
      if (name.startsWith('profile ')) name = name.slice('profile '.length).trim();
    }
    if (name) names.push(name);
  }
  return names;
}

export function parseAwsProfileNames(configText: string, credentialsText: string): string[] {
  const names = new Set<string>([
    ...sectionNames(configText, true),
    ...sectionNames(credentialsText, false),
  ]);
  const rest = [...names].filter(n => n !== 'default');
  return names.has('default') ? ['default', ...rest] : rest;
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      log.debug(`No AWS file at ${path}`);
    } else {
      log.warn(`Failed to read AWS file at ${path}: ${(err as Error).message}`);
    }
    return '';
  }
}

export async function listAwsProfiles(): Promise<string[]> {
  const awsDir = join(homedir(), '.aws');
  const [config, credentials] = await Promise.all([
    readOrEmpty(join(awsDir, 'config')),
    readOrEmpty(join(awsDir, 'credentials')),
  ]);
  return parseAwsProfileNames(config, credentials);
}
