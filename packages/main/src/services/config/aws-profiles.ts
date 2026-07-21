/**
 * AWS profile discovery for the connection dialog's aws-iam auth picker.
 * Pure parsing is separated from fs so it's unit-testable. We only need
 * section NAMES — credential resolution itself is the connector's job.
 */
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../../utils/logger';

const log = createLogger('AwsProfiles');

// ~/.aws/config uses "[profile name]" (except "[default]");
// ~/.aws/credentials uses bare "[name]". Ignore sso-session/services sections.
const CONFIG_SECTION_RE = /^\[(?:profile\s+)?([^\]\s][^\]]*)\]\s*$/;
const NON_PROFILE_PREFIXES = ['sso-session ', 'services '];

export function parseAwsProfileNames(configText: string, credentialsText: string): string[] {
  const names = new Set<string>();
  for (const text of [configText, credentialsText]) {
    for (const line of text.split('\n')) {
      const match = CONFIG_SECTION_RE.exec(line.trim());
      if (!match) continue;
      const name = match[1].trim();
      if (NON_PROFILE_PREFIXES.some(p => line.trim().slice(1).startsWith(p))) continue;
      names.add(name);
    }
  }
  const sorted = [...names].filter(n => n !== 'default');
  return names.has('default') ? ['default', ...sorted] : sorted;
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    log.debug(`No AWS file at ${path}: ${(err as Error).message}`);
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
