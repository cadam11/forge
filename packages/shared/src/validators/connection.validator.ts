/**
 * Connection Profile Validators
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// SQL Server reserved words that can't be used as identifiers
const SQL_RESERVED_WORDS = new Set([
  'add',
  'all',
  'alter',
  'and',
  'any',
  'as',
  'asc',
  'authorization',
  'backup',
  'begin',
  'between',
  'break',
  'browse',
  'bulk',
  'by',
  'cascade',
  'case',
  'check',
  'checkpoint',
  'close',
  'clustered',
  'coalesce',
  'collate',
  'column',
  'commit',
  'compute',
  'constraint',
  'contains',
  'containstable',
  'continue',
  'convert',
  'create',
  'cross',
  'current',
  'current_date',
  'current_time',
  'current_timestamp',
  'current_user',
  'cursor',
  'database',
  'dbcc',
  'deallocate',
  'declare',
  'default',
  'delete',
  'deny',
  'desc',
  'disk',
  'distinct',
  'distributed',
  'double',
  'drop',
  'dump',
  'else',
  'end',
  'errlvl',
  'escape',
  'except',
  'exec',
  'execute',
  'exists',
  'exit',
  'external',
  'fetch',
  'file',
  'fillfactor',
  'for',
  'foreign',
  'freetext',
  'freetexttable',
  'from',
  'full',
  'function',
  'goto',
  'grant',
  'group',
  'having',
  'holdlock',
  'identity',
  'identity_insert',
  'identitycol',
  'if',
  'in',
  'index',
  'inner',
  'insert',
  'intersect',
  'into',
  'is',
  'join',
  'key',
  'kill',
  'left',
  'like',
  'lineno',
  'load',
  'merge',
  'national',
  'nocheck',
  'nonclustered',
  'not',
  'null',
  'nullif',
  'of',
  'off',
  'offsets',
  'on',
  'open',
  'opendatasource',
  'openquery',
  'openrowset',
  'openxml',
  'option',
  'or',
  'order',
  'outer',
  'over',
  'percent',
  'pivot',
  'plan',
  'precision',
  'primary',
  'print',
  'proc',
  'procedure',
  'public',
  'raiserror',
  'read',
  'readtext',
  'reconfigure',
  'references',
  'replication',
  'restore',
  'restrict',
  'return',
  'revert',
  'revoke',
  'right',
  'rollback',
  'rowcount',
  'rowguidcol',
  'rule',
  'save',
  'schema',
  'securityaudit',
  'select',
  'semantickeyphrasetable',
  'semanticsimilaritydetailstable',
  'semanticsimilaritytable',
  'session_user',
  'set',
  'setuser',
  'shutdown',
  'some',
  'statistics',
  'system_user',
  'table',
  'tablesample',
  'textsize',
  'then',
  'to',
  'top',
  'tran',
  'transaction',
  'trigger',
  'truncate',
  'try_convert',
  'tsequal',
  'union',
  'unique',
  'unpivot',
  'update',
  'updatetext',
  'use',
  'user',
  'values',
  'varying',
  'view',
  'waitfor',
  'when',
  'where',
  'while',
  'with',
  'within',
  'writetext',
]);

/**
 * Validate a connection profile name
 */
export function validateConnectionName(name: string): ValidationResult {
  const errors: string[] = [];

  if (!name || name.trim().length === 0) {
    errors.push('Connection name is required');
  } else {
    if (name.length > 128) {
      errors.push('Connection name must be 128 characters or less');
    }
    if (name.trim() !== name) {
      errors.push('Connection name should not have leading or trailing spaces');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a server hostname or IP address
 */
export function validateServer(server: string): ValidationResult {
  const errors: string[] = [];

  if (!server || server.trim().length === 0) {
    errors.push('Server is required');
    return { valid: false, errors };
  }

  const trimmed = server.trim();

  // Check for valid hostname or IP
  const hostnameRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^localhost$/i;

  if (!hostnameRegex.test(trimmed) && !ipv4Regex.test(trimmed) && !ipv6Regex.test(trimmed)) {
    errors.push('Invalid server hostname or IP address');
  }

  // Validate IPv4 octets
  if (ipv4Regex.test(trimmed)) {
    const octets = trimmed.split('.').map(Number);
    if (octets.some(o => o > 255)) {
      errors.push('Invalid IP address: octets must be 0-255');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a port number
 */
export function validatePort(port: number | string): ValidationResult {
  const errors: string[] = [];

  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  if (isNaN(portNum)) {
    errors.push('Port must be a number');
  } else if (portNum < 1 || portNum > 65535) {
    errors.push('Port must be between 1 and 65535');
  } else if (portNum < 1024 && portNum !== 1433) {
    // Warning: using a well-known port other than default SQL Server
    // This is a warning, not an error
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a username
 */
export function validateUsername(username: string, authType: string): ValidationResult {
  const errors: string[] = [];

  if (authType === 'sql') {
    if (!username || username.trim().length === 0) {
      errors.push('Username is required for SQL Server authentication');
    } else if (username.length > 128) {
      errors.push('Username must be 128 characters or less');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a database name
 */
export function validateDatabaseName(name: string): ValidationResult {
  const errors: string[] = [];

  if (!name || name.trim().length === 0) {
    errors.push('Database name is required');
    return { valid: false, errors };
  }

  const trimmed = name.trim();

  // SQL Server database name rules
  if (trimmed.length > 128) {
    errors.push('Database name must be 128 characters or less');
  }

  // Must start with a letter, underscore, @ or #
  if (!/^[a-zA-Z_@#]/.test(trimmed)) {
    errors.push('Database name must start with a letter, underscore, @ or #');
  }

  // Can only contain letters, digits, underscores, @, #, $
  if (!/^[a-zA-Z_@#][a-zA-Z0-9_@#$]*$/.test(trimmed)) {
    errors.push('Database name can only contain letters, digits, underscores, @, #, and $');
  }

  // Check for reserved words
  if (SQL_RESERVED_WORDS.has(trimmed.toLowerCase())) {
    errors.push(`"${trimmed}" is a SQL Server reserved word`);
  }

  // Check for system database names
  const systemDbs = ['master', 'model', 'msdb', 'tempdb', 'resource'];
  if (systemDbs.includes(trimmed.toLowerCase())) {
    errors.push(`"${trimmed}" is a system database name`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a complete connection profile
 */
export function validateConnectionProfile(profile: {
  name: string;
  server: string;
  port: number;
  authenticationType: string;
  username?: string;
}): ValidationResult {
  const errors: string[] = [];

  const nameResult = validateConnectionName(profile.name);
  errors.push(...nameResult.errors);

  const serverResult = validateServer(profile.server);
  errors.push(...serverResult.errors);

  const portResult = validatePort(profile.port);
  errors.push(...portResult.errors);

  if (profile.authenticationType === 'sql') {
    const usernameResult = validateUsername(profile.username || '', profile.authenticationType);
    errors.push(...usernameResult.errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize a profile name (remove invalid characters)
 */
export function sanitizeProfileName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filesystem characters
    .substring(0, 128);
}

/**
 * Sanitize a database name for use in SQL
 */
export function sanitizeDatabaseName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_@#$]/g, '_') // Replace invalid chars with underscore
    .replace(/^[^a-zA-Z_@#]/, '_') // Ensure starts with valid char
    .substring(0, 128);
}

/**
 * Check if a string is a SQL reserved word
 */
export function isReservedWord(word: string): boolean {
  return SQL_RESERVED_WORDS.has(word.toLowerCase());
}
