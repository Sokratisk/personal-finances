import { HttpErrorResponse, type HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { defer, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/auth.service';
import { DemoBackend, DemoError } from './demo-backend';

/** In demo mode, answer every /api call from the in-memory backend — no request leaves the browser. */
export const demoInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const prefix = `${environment.apiUrl}/api`;
  if (!auth.demo() || !req.url.startsWith(prefix)) return next(req);

  const backend = inject(DemoBackend);
  return defer(() => {
    try {
      const body = backend.handle(req.method, req.url.slice(prefix.length).split('?')[0]!, req.body);
      return of(new HttpResponse({ status: 200, body, url: req.url }));
    } catch (e) {
      const status = e instanceof DemoError ? e.status : 500;
      const message = e instanceof Error ? e.message : 'Demo error';
      return throwError(() => new HttpErrorResponse({ status, error: { error: message }, url: req.url }));
    }
  });
};
