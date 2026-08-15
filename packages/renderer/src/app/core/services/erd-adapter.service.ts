import { Injectable, inject } from '@angular/core';
import type { ForeignKeyInfo } from '@forgedb/shared';
import type { ERDNode, ERDField } from '../../shared/components/erd-diagram/erd-types';
import { IpcService } from './ipc.service';
import { firstValueFrom } from 'rxjs';

/**
 * Enriched column metadata from the main process
 */
interface EnrichedColumn {
  name: string;
  type: string;
  nullable: boolean;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  defaultValue: string | null;
  foreignKey: {
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
    constraintName: string;
  } | null;
}

/**
 * Service to adapt SQL Server metadata to ERD diagram format
 */
@Injectable({
  providedIn: 'root',
})
export class ERDAdapterService {
  private ipc = inject(IpcService);

  /**
   * Build ERD nodes for a specific table and its related tables (by FK relationships)
   * This is useful for showing a focused view of a single table and its connections
   */
  async buildERDForTableWithRelations(
    connectionId: string,
    database: string,
    schema: string,
    tableName: string,
    depth = 1
  ): Promise<ERDNode[]> {
    const nodes: ERDNode[] = [];
    const visitedTables = new Set<string>();
    const tablesToProcess: Array<{ schema: string; name: string; currentDepth: number }> = [
      { schema, name: tableName, currentDepth: 0 },
    ];

    while (tablesToProcess.length > 0) {
      const current = tablesToProcess.shift()!;
      const tableKey = `${current.schema}.${current.name}`;

      if (visitedTables.has(tableKey)) continue;
      visitedTables.add(tableKey);

      // Build the ERD node for this table
      const node = await this.buildERDNodeForTable(
        connectionId,
        database,
        current.schema,
        current.name
      );
      nodes.push(node);

      // If we haven't reached max depth, add related tables to process
      if (current.currentDepth < depth) {
        // Get FK relationships (outgoing)
        const foreignKeys = await firstValueFrom(
          this.ipc.getTableKeys(connectionId, database, current.schema, current.name)
        );

        for (const fk of foreignKeys) {
          const relatedKey = `${fk.referencedSchema}.${fk.referencedTable}`;
          if (!visitedTables.has(relatedKey)) {
            tablesToProcess.push({
              schema: fk.referencedSchema,
              name: fk.referencedTable,
              currentDepth: current.currentDepth + 1,
            });
          }
        }
      }
    }

    return nodes;
  }

  /**
   * Build a single ERD node for a table
   */
  async buildERDNodeForTable(
    connectionId: string,
    database: string,
    schema: string,
    tableName: string
  ): Promise<ERDNode> {
    // Get enriched column metadata which includes PK/FK information
    const columns = await this.getEnrichedColumns(connectionId, database, schema, tableName);

    // Generate a unique node ID from schema.table
    const nodeId = `${schema}.${tableName}`;

    // Transform columns to ERD fields
    const fields: ERDField[] = columns.map(col => {
      const field: ERDField = {
        id: `${nodeId}.${col.name}`,
        name: col.name,
        type: this.formatColumnType(col),
        isPrimaryKey: col.isPrimaryKey,
        allowsNull: col.nullable,
        defaultValue: col.defaultValue ?? undefined,
        length: col.maxLength ?? undefined,
        precision: col.precision ?? undefined,
        scale: col.scale ?? undefined,
        autoIncrement: col.isIdentity,
      };

      // Add FK relationship info if present
      if (col.foreignKey) {
        field.relatedNodeId = `${col.foreignKey.referencedSchema}.${col.foreignKey.referencedTable}`;
        field.relatedNodeName = col.foreignKey.referencedTable;
        field.relatedFieldName = col.foreignKey.referencedColumn;
        field.customData = {
          constraintName: col.foreignKey.constraintName,
        };
      }

      return field;
    });

    return {
      id: nodeId,
      name: tableName,
      schemaName: schema,
      fields,
      customData: {
        database,
        connectionId,
      },
    };
  }

  /**
   * Get enriched column metadata by building it from separate API calls
   */
  private async getEnrichedColumns(
    connectionId: string,
    database: string,
    schema: string,
    tableName: string
  ): Promise<EnrichedColumn[]> {
    // Build enriched columns from separate API calls
    return this.buildEnrichedColumnsFromSeparateCalls(connectionId, database, schema, tableName);
  }

  /**
   * Fallback method to build enriched columns from separate API calls
   */
  private async buildEnrichedColumnsFromSeparateCalls(
    connectionId: string,
    database: string,
    schema: string,
    tableName: string
  ): Promise<EnrichedColumn[]> {
    const [columns, foreignKeys] = await Promise.all([
      firstValueFrom(this.ipc.getTableColumns(connectionId, database, schema, tableName)),
      firstValueFrom(this.ipc.getTableKeys(connectionId, database, schema, tableName)),
    ]);

    // Build FK lookup
    const fkMap = new Map<string, ForeignKeyInfo>();
    for (const fk of foreignKeys) {
      for (const col of fk.columns) {
        fkMap.set(col, fk);
      }
    }

    return columns.map(col => {
      const fk = fkMap.get(col.name);
      const fkColIndex = fk ? fk.columns.indexOf(col.name) : -1;

      return {
        name: col.name,
        type: col.dataType,
        nullable: col.isNullable,
        maxLength: col.maxLength ?? null,
        precision: col.precision ?? null,
        scale: col.scale ?? null,
        isPrimaryKey: col.isPrimaryKey ?? false,
        isIdentity: false, // Not available in basic column info
        defaultValue: col.defaultValue ?? null,
        foreignKey: fk
          ? {
              referencedSchema: fk.referencedSchema,
              referencedTable: fk.referencedTable,
              referencedColumn: fk.referencedColumns[fkColIndex] || fk.referencedColumns[0],
              constraintName: fk.name,
            }
          : null,
      };
    });
  }

  /**
   * Format column type for display
   */
  private formatColumnType(col: EnrichedColumn): string {
    const type = col.type.toLowerCase();

    // Types with length
    if (['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(type)) {
      if (col.maxLength === -1) {
        return `${col.type}(MAX)`;
      }
      const len = type.startsWith('n') && col.maxLength ? col.maxLength / 2 : col.maxLength;
      return `${col.type}(${len})`;
    }

    // Types with precision and scale
    if (['decimal', 'numeric'].includes(type)) {
      return `${col.type}(${col.precision}, ${col.scale})`;
    }

    return col.type;
  }

  /**
   * Build ERD nodes for all tables in a database
   */
  async buildERDForDatabase(connectionId: string, database: string): Promise<ERDNode[]> {
    // Get all tables - we need to use the explorer children API
    const tablesMetadata = await window.forge.explorer.getChildren(
      connectionId,
      database,
      'Tables'
    );

    // Build ERD nodes for all tables in parallel (limit concurrency to avoid overwhelming the server)
    const nodes: ERDNode[] = [];
    const batchSize = 5;

    for (let i = 0; i < tablesMetadata.length; i += batchSize) {
      const batch = tablesMetadata.slice(i, i + batchSize);
      const batchNodes = await Promise.all(
        batch.map(table =>
          this.buildERDNodeForTable(connectionId, database, table.schema, table.name)
        )
      );
      nodes.push(...batchNodes);
    }

    return nodes;
  }
}
