import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Year · Personal Finances', loadComponent: () => import('./year/year-view').then((m) => m.YearView) },
  { path: 'dashboard', title: 'Dashboard · Personal Finances', loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard) },
  { path: 'trips', title: 'Trips · Personal Finances', loadComponent: () => import('./trips/trips').then((m) => m.Trips) },
  { path: 'entries', title: 'Entries · Personal Finances', loadComponent: () => import('./entries/entries').then((m) => m.Entries) },
  { path: 'funds', title: 'Funds · Personal Finances', loadComponent: () => import('./funds/funds').then((m) => m.Funds) },
  { path: 'categories', title: 'Categories · Personal Finances', loadComponent: () => import('./categories/categories').then((m) => m.Categories) },
  { path: 'settings', title: 'Settings · Personal Finances', loadComponent: () => import('./settings/settings').then((m) => m.Settings) },
  { path: '**', redirectTo: '' },
];
