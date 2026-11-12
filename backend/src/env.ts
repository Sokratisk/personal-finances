export interface Bindings {
  ASSETS: Fetcher;
  FIREBASE_PROJECT_ID: string;
  FIRESTORE_DATABASE: string;
  /** Service-account JSON (Cloudflare secret). */
  FIREBASE_SERVICE_ACCOUNT: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { uid: string; email?: string };
};
