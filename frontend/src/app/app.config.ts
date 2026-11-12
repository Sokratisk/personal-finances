import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideEchartsCore } from 'ngx-echarts';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { demoInterceptor } from './demo/demo.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // Demo first: in demo mode it answers /api calls in the browser, so nothing reaches the server.
    provideHttpClient(withInterceptors([demoInterceptor, authInterceptor])),
    // ECharts is loaded on demand the first time a chart renders.
    provideEchartsCore({ echarts: () => import('./echarts').then((m) => m.default), theme: 'dark' }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
