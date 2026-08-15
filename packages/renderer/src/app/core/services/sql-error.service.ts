import { Injectable } from '@angular/core';

export interface ParsedSqlError {
  code: number;
  severity: number;
  state: number;
  message: string;
  line?: number;
  procedure?: string;
  friendlyMessage: string;
  suggestion?: string;
  documentationUrl?: string;
  category: 'syntax' | 'permission' | 'constraint' | 'connection' | 'object' | 'data' | 'other';
}

interface ErrorPattern {
  code: number | RegExp;
  category: ParsedSqlError['category'];
  friendlyMessage: string | ((match: RegExpMatchArray | null, message: string) => string);
  suggestion?: string | ((match: RegExpMatchArray | null, message: string) => string);
}

@Injectable({ providedIn: 'root' })
export class SqlErrorService {
  private readonly errorPatterns: ErrorPattern[] = [
    // Syntax errors
    {
      code: 102,
      category: 'syntax',
      friendlyMessage: 'Syntax error in your SQL statement',
      suggestion: 'Check for missing commas, parentheses, or quotes near the indicated position',
    },
    {
      code: 156,
      category: 'syntax',
      friendlyMessage: "Incorrect syntax near a keyword",
      suggestion: 'A SQL keyword might be used incorrectly. Check the highlighted keyword.',
    },
    {
      code: 170,
      category: 'syntax',
      friendlyMessage: 'Line parsing error',
      suggestion: 'Check for unexpected characters or incomplete statements',
    },

    // Object not found errors
    {
      code: 208,
      category: 'object',
      friendlyMessage: (_, msg) => {
        const match = msg.match(/Invalid object name '([^']+)'/);
        return match ? `Table or view "${match[1]}" not found` : 'Table or view not found';
      },
      suggestion: 'Check the object name spelling and ensure you have the correct database selected',
    },
    {
      code: 2812,
      category: 'object',
      friendlyMessage: (_, msg) => {
        const match = msg.match(/Could not find stored procedure '([^']+)'/);
        return match ? `Stored procedure "${match[1]}" not found` : 'Stored procedure not found';
      },
      suggestion: 'Verify the procedure exists and check the schema prefix (e.g., dbo.ProcName)',
    },

    // Permission errors
    {
      code: 229,
      category: 'permission',
      friendlyMessage: 'Permission denied',
      suggestion: 'You don\'t have permission to perform this action. Contact your database administrator.',
    },
    {
      code: 230,
      category: 'permission',
      friendlyMessage: 'Column-level permission denied',
      suggestion: 'You don\'t have access to one or more columns. Check column permissions.',
    },

    // Constraint violations
    {
      code: 547,
      category: 'constraint',
      friendlyMessage: (_, msg) => {
        if (msg.includes('FOREIGN KEY')) {
          return 'Foreign key constraint violation';
        }
        if (msg.includes('CHECK')) {
          return 'Check constraint violation';
        }
        return 'Constraint violation';
      },
      suggestion: (_, msg) => {
        if (msg.includes('FOREIGN KEY') && msg.includes('INSERT')) {
          return 'The referenced record does not exist in the parent table';
        }
        if (msg.includes('FOREIGN KEY') && msg.includes('DELETE')) {
          return 'Cannot delete: other records reference this row';
        }
        return 'Data violates a database constraint';
      },
    },
    {
      code: 2627,
      category: 'constraint',
      friendlyMessage: 'Duplicate key violation',
      suggestion: 'A record with this key already exists. Use UPDATE instead of INSERT, or change the key value.',
    },
    {
      code: 2601,
      category: 'constraint',
      friendlyMessage: 'Unique index violation',
      suggestion: 'A duplicate value was found for a unique index. Check for existing records with the same value.',
    },
    {
      code: 515,
      category: 'constraint',
      friendlyMessage: (_, msg) => {
        const match = msg.match(/column '([^']+)'/);
        return match
          ? `Column "${match[1]}" cannot be NULL`
          : 'Required column cannot be NULL';
      },
      suggestion: 'Provide a value for this required column',
    },

    // Data type errors
    {
      code: 245,
      category: 'data',
      friendlyMessage: 'Data type conversion failed',
      suggestion: 'Check that the value format matches the column type (e.g., dates, numbers)',
    },
    {
      code: 8114,
      category: 'data',
      friendlyMessage: 'Cannot convert data type',
      suggestion: 'The value cannot be converted to the target column type. Check for invalid characters.',
    },
    {
      code: 8152,
      category: 'data',
      friendlyMessage: 'String or binary data would be truncated',
      suggestion: 'The value is too long for the column. Shorten the text or increase column size.',
    },

    // Connection errors
    {
      code: 18456,
      category: 'connection',
      friendlyMessage: 'Login failed',
      suggestion: 'Check your username and password. Ensure the account is not locked.',
    },
    {
      code: 4060,
      category: 'connection',
      friendlyMessage: 'Cannot open database',
      suggestion: 'The database may not exist, or you don\'t have access to it.',
    },

    // Deadlock and timeout
    {
      code: 1205,
      category: 'other',
      friendlyMessage: 'Transaction deadlock',
      suggestion: 'Your query was chosen as the deadlock victim. Retry the operation.',
    },
    {
      code: -2,
      category: 'connection',
      friendlyMessage: 'Query timeout',
      suggestion: 'The query took too long. Try optimizing the query or increasing the timeout.',
    },

    // Division by zero
    {
      code: 8134,
      category: 'data',
      friendlyMessage: 'Division by zero',
      suggestion: 'Add a check to handle zero values: NULLIF(divisor, 0) or CASE WHEN divisor = 0 THEN ...',
    },
  ];

  /**
   * Parse a SQL Server error and return enriched error information
   */
  parseError(error: Error | string | any): ParsedSqlError {
    const errorMessage = typeof error === 'string' ? error : error?.message || String(error);
    const errorNumber = this.extractErrorNumber(error);
    const severity = this.extractSeverity(error);
    const state = this.extractState(error);
    const line = this.extractLineNumber(errorMessage);
    const procedure = this.extractProcedure(errorMessage);

    // Find matching pattern
    const pattern = this.findMatchingPattern(errorNumber, errorMessage);

    if (pattern) {
      return {
        code: errorNumber,
        severity,
        state,
        message: errorMessage,
        line,
        procedure,
        category: pattern.category,
        friendlyMessage: typeof pattern.friendlyMessage === 'function'
          ? pattern.friendlyMessage(null, errorMessage)
          : pattern.friendlyMessage,
        suggestion: pattern.suggestion
          ? (typeof pattern.suggestion === 'function'
            ? pattern.suggestion(null, errorMessage)
            : pattern.suggestion)
          : undefined,
        documentationUrl: this.getDocumentationUrl(errorNumber),
      };
    }

    // Default parsing for unknown errors
    return {
      code: errorNumber,
      severity,
      state,
      message: errorMessage,
      line,
      procedure,
      category: 'other',
      friendlyMessage: this.generateFriendlyMessage(errorMessage),
      documentationUrl: errorNumber > 0 ? this.getDocumentationUrl(errorNumber) : undefined,
    };
  }

  private extractErrorNumber(error: any): number {
    if (typeof error === 'object') {
      if (error.number) return error.number;
      if (error.code) return error.code;
    }

    // Try to extract from message
    const match = String(error?.message || error).match(/Msg (\d+)/);
    if (match) return parseInt(match[1], 10);

    // Check for ECONNREFUSED etc.
    if (String(error).includes('ECONNREFUSED')) return -1;
    if (String(error).includes('ETIMEDOUT')) return -2;

    return 0;
  }

  private extractSeverity(error: any): number {
    if (typeof error === 'object' && error.severity) {
      return error.severity;
    }
    const match = String(error?.message || error).match(/Severity (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractState(error: any): number {
    if (typeof error === 'object' && error.state) {
      return error.state;
    }
    const match = String(error?.message || error).match(/State (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractLineNumber(message: string): number | undefined {
    const match = message.match(/Line (\d+)/i);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private extractProcedure(message: string): string | undefined {
    const match = message.match(/Procedure (\w+)/i);
    return match ? match[1] : undefined;
  }

  private findMatchingPattern(errorCode: number, message: string): ErrorPattern | undefined {
    return this.errorPatterns.find(pattern => {
      if (typeof pattern.code === 'number') {
        return pattern.code === errorCode;
      }
      return pattern.code.test(message);
    });
  }

  private generateFriendlyMessage(message: string): string {
    // Simplify common patterns
    if (message.includes('Invalid object name')) {
      return 'Object not found in database';
    }
    if (message.includes('permission denied')) {
      return 'Permission denied';
    }
    if (message.includes('timeout')) {
      return 'Operation timed out';
    }
    if (message.includes('connection')) {
      return 'Connection error';
    }

    // Truncate long messages
    if (message.length > 150) {
      return message.substring(0, 147) + '...';
    }

    return message;
  }

  private getDocumentationUrl(errorCode: number): string {
    return `https://docs.microsoft.com/en-us/sql/relational-databases/errors-events/database-engine-events-and-errors?view=sql-server-ver16#errors-${errorCode}`;
  }

  /**
   * Get severity level description
   */
  getSeverityDescription(severity: number): string {
    if (severity <= 10) return 'Informational';
    if (severity <= 16) return 'Error (user correctable)';
    if (severity <= 19) return 'Error (software)';
    if (severity <= 24) return 'Fatal error';
    return 'Unknown';
  }

  /**
   * Get severity color for UI
   */
  getSeverityColor(severity: number): string {
    if (severity <= 10) return 'info';
    if (severity <= 16) return 'warning';
    return 'error';
  }
}
