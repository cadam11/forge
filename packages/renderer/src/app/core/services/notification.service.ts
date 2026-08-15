import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { LogService } from './log.service';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface NotificationOptions {
  message: string;
  type?: NotificationType;
  duration?: number;
  action?: string;
  /**
   * Full error detail (stack, SQL, underlying cause) for the Output panel.
   * When present on an error toast, the toast action becomes "Details" and
   * clicking it opens the panel scrolled to this entry.
   */
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly logService = inject(LogService);

  private readonly defaultDuration = 4000;
  private readonly errorDuration = 8000;

  private readonly panelClasses: Record<NotificationType, string> = {
    success: 'notification-success',
    error: 'notification-error',
    warning: 'notification-warning',
    info: 'notification-info',
  };

  show(options: NotificationOptions): void {
    const { message, type = 'info', duration, detail } = options;

    // Mirror warnings/errors into the diagnostics timeline so the user can
    // always find the full story in the Output panel, even after the toast
    // auto-dismisses.
    let entryId: string | undefined;
    if (type === 'error' || type === 'warning') {
      // NotificationType 'warning' maps to the LogLevel 'warn'.
      const level = type === 'warning' ? 'warn' : 'error';
      entryId = this.logService.addLocal(level, 'UI', message, detail).id;
    }

    // For errors, offer a "Details" action that jumps to the Output panel.
    const action = options.action ?? (type === 'error' ? 'Details' : 'Dismiss');

    const config: MatSnackBarConfig = {
      duration: duration ?? (type === 'error' ? this.errorDuration : this.defaultDuration),
      horizontalPosition: 'right',
      verticalPosition: 'bottom',
      panelClass: [this.panelClasses[type]],
    };

    const ref = this.snackBar.open(message, action, config);

    if (type === 'error' && action === 'Details') {
      ref.onAction().subscribe(() => this.logService.open(entryId));
    }
  }

  success(message: string, duration?: number): void {
    this.show({ message, type: 'success', duration });
  }

  /**
   * @param detail Optional full error detail surfaced via the toast's "Details"
   *   action and the Output panel.
   */
  error(message: string, detail?: string, duration?: number): void {
    this.show({ message, type: 'error', detail, duration });
  }

  warning(message: string, duration?: number): void {
    this.show({ message, type: 'warning', duration });
  }

  info(message: string, duration?: number): void {
    this.show({ message, type: 'info', duration });
  }

  dismiss(): void {
    this.snackBar.dismiss();
  }
}
