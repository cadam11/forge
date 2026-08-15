import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient } from '@angular/common/http';
import { ErrorHandler } from '@angular/core';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { GlobalErrorHandler } from './app/core/services/global-error-handler';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes, withComponentInputBinding(), withHashLocation()),
    provideAnimationsAsync(),
    provideHttpClient(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
  ],
}).catch(err => console.error('Bootstrap error:', err));
