import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Attaches the Firebase ID token to every request going to our API. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isApi = req.url.startsWith(`${environment.apiUrl}/api/`);
  if (!isApi) return next(req);

  const auth = inject(AuthService);
  return from(auth.idToken()).pipe(
    switchMap((token) =>
      next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req),
    ),
  );
};
