import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/welcome/welcome.component').then(m => m.WelcomeComponent),
  },
  {
    path: 'connections',
    loadComponent: () =>
      import('./features/connections/connections.component').then(m => m.ConnectionsComponent),
  },
  {
    path: 'explorer',
    loadComponent: () =>
      import('./features/explorer/explorer.component').then(m => m.ExplorerComponent),
  },
  {
    path: 'query',
    loadComponent: () => import('./features/query/query.component').then(m => m.QueryComponent),
  },
  {
    path: 'backup',
    loadComponent: () => import('./features/backup/backup.component').then(m => m.BackupComponent),
  },
  {
    path: 'restore',
    loadComponent: () =>
      import('./features/restore/restore.component').then(m => m.RestoreComponent),
  },
  {
    path: 'erd',
    loadComponent: () => import('./features/erd/erd.component').then(m => m.ErdComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
