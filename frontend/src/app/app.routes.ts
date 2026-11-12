import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./transactions/transactions').then((m) => m.Transactions),
  },
  { path: '**', redirectTo: '' },
];
