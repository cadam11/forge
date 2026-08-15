export * from './ipc-channels';

// Application constants
export const APP_NAME = 'Forge';
export const APP_ID = 'ca.adam11.forge';

// Default values
export const DEFAULT_PORT = 1433;
export const DEFAULT_CONNECTION_TIMEOUT = 15;
export const DEFAULT_REQUEST_TIMEOUT = 30;

// SQL Server system databases
export const SYSTEM_DATABASES = ['master', 'model', 'msdb', 'tempdb'] as const;

// File extensions
export const BACKUP_EXTENSIONS = ['.bak', '.trn', '.dif'] as const;
export const QUERY_EXTENSIONS = ['.sql', '.tsql'] as const;
