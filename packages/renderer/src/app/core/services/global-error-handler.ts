import { ErrorHandler, Injectable, inject } from '@angular/core';
import { LogService } from './log.service';

/**
 * Funnels otherwise-silent uncaught renderer errors into the diagnostics
 * timeline so they show up in the Output panel (and the on-disk log) instead
 * of only landing in the devtools console. Still rethrows to the console so
 * Angular's default reporting and source maps remain intact.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly logService = inject(LogService);

  handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logService.addLocal('error', 'Renderer', err.message, err.stack);
    // Preserve default behavior (console + zone reporting).
    console.error(err);
  }
}
