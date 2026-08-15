/**
 * Table Properties Service
 * Manages the table properties panel state and data loading
 */

import { Injectable, signal } from '@angular/core';
import type { TableProperties } from '@forgedb/shared';

export interface TablePropertiesRequest {
  connectionId: string;
  databaseName: string;
  schema: string;
  tableName: string;
  objectType?: 'table' | 'view' | 'procedure' | 'function';
}

@Injectable({ providedIn: 'root' })
export class TablePropertiesService {
  private readonly _isOpen = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _properties = signal<TableProperties | null>(null);
  private readonly _request = signal<TablePropertiesRequest | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly properties = this._properties.asReadonly();
  readonly request = this._request.asReadonly();

  async open(request: TablePropertiesRequest): Promise<void> {
    this._request.set(request);
    this._isOpen.set(true);
    this._loading.set(true);
    this._error.set(null);
    this._properties.set(null);

    try {
      const properties = await window.forge.explorer.getTableProperties(
        request.connectionId,
        request.databaseName,
        request.schema,
        request.tableName
      );
      this._properties.set(properties);
      this._loading.set(false);
    } catch (err) {
      console.error('[TablePropertiesService] Error loading properties:', err);
      this._error.set(err instanceof Error ? err.message : 'Failed to load table properties');
      this._loading.set(false);
    }
  }

  close(): void {
    this._isOpen.set(false);
  }

  async retry(): Promise<void> {
    const request = this._request();
    if (request) {
      await this.open(request);
    }
  }
}
