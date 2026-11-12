/** What the Google helpers (Firestore, Sheets) need — also satisfied by the Node import script. */
export interface GoogleEnv {
  FIREBASE_PROJECT_ID: string;
  FIRESTORE_DATABASE: string;
  /** Service-account JSON (Cloudflare secret). */
  FIREBASE_SERVICE_ACCOUNT: string;
}

export interface Bindings extends GoogleEnv {
  ASSETS: Fetcher;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { uid: string; email?: string };
};
