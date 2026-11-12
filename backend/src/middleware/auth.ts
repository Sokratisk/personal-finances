import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from '../env';

// Google's public keys for Firebase ID tokens (jose caches them between requests).
const firebaseKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

/** Verifies the Firebase ID token the frontend sends as `Authorization: Bearer <token>`. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HTTPException(401, { message: 'Missing bearer token' });

  const projectId = c.env.FIREBASE_PROJECT_ID;
  try {
    const { payload } = await jwtVerify(token, firebaseKeys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no sub');
    c.set('uid', payload.sub);
    c.set('email', typeof payload.email === 'string' ? payload.email : undefined);
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
  await next();
});
