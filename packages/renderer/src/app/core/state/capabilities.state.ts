/**
 * Per-connection engine capabilities, populated from the ActiveConnection
 * returned by connection:connect. Standalone (no service dependencies) so
 * both ConnectionStateService and ExplorerStateService can inject it
 * without a cycle. Absence of an entry means "assume fully capable" —
 * existing engines behave exactly as before this store existed.
 */

import { Injectable, signal } from '@angular/core';
import { FULL_CAPABILITIES } from '@joinery/shared';
import type { EngineCapabilities, EngineVariant } from '@joinery/shared';

export interface ConnectionCapabilitiesEntry {
  capabilities: EngineCapabilities;
  variant?: EngineVariant;
}

@Injectable({ providedIn: 'root' })
export class CapabilitiesStore {
  private readonly _byConnection = signal<ReadonlyMap<string, ConnectionCapabilitiesEntry>>(
    new Map()
  );

  set(connectionId: string, entry: ConnectionCapabilitiesEntry): void {
    const next = new Map(this._byConnection());
    next.set(connectionId, entry);
    this._byConnection.set(next);
  }

  clear(connectionId: string): void {
    const next = new Map(this._byConnection());
    next.delete(connectionId);
    this._byConnection.set(next);
  }

  for(connectionId: string | undefined): EngineCapabilities {
    if (!connectionId) return FULL_CAPABILITIES;
    return this._byConnection().get(connectionId)?.capabilities ?? FULL_CAPABILITIES;
  }

  variantFor(connectionId: string | undefined): EngineVariant | undefined {
    if (!connectionId) return undefined;
    return this._byConnection().get(connectionId)?.variant;
  }
}
