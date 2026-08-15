import { Injectable, signal, computed } from '@angular/core';

interface RunningQuery {
  tabId: string;
  tabTitle: string;
  startTime: number;
}

@Injectable({ providedIn: 'root' })
export class QueryExecutionService {
  private readonly _runningQueries = signal<RunningQuery[]>([]);

  readonly runningQueries = this._runningQueries.asReadonly();
  readonly runningCount = computed(() => this._runningQueries().length);
  readonly isAnyRunning = computed(() => this._runningQueries().length > 0);

  startExecution(tabId: string, tabTitle: string): void {
    this._runningQueries.update(queries => [
      ...queries.filter(q => q.tabId !== tabId),
      { tabId, tabTitle, startTime: Date.now() },
    ]);
  }

  endExecution(tabId: string): void {
    this._runningQueries.update(queries => queries.filter(q => q.tabId !== tabId));
  }
}
