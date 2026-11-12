import { Injectable, inject, signal } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { environment } from '../../environments/environment';
import { DemoBackend } from '../demo/demo-backend';

/** Stand-in user for demo mode (no Firebase account involved). */
const DEMO_USER = { uid: 'demo', displayName: 'Demo user', email: null } as unknown as User;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = getAuth(initializeApp(environment.firebase));
  private readonly demoBackend = inject(DemoBackend);

  /** `undefined` while Firebase restores the session, `null` when signed out. */
  readonly user = signal<User | null | undefined>(undefined);
  /** Demo mode: mock data, every API call is answered in the browser (see demo.interceptor.ts). */
  readonly demo = signal(false);

  constructor() {
    onAuthStateChanged(this.auth, (u) => {
      if (!this.demo()) this.user.set(u);
    });
  }

  signIn() {
    return signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  /** Enter the demo with fresh mock data. */
  startDemo() {
    this.demoBackend.reset();
    this.demo.set(true);
    this.user.set(DEMO_USER);
  }

  async signOut() {
    if (this.demo()) {
      this.demo.set(false);
      this.user.set(null);
      return;
    }
    await signOut(this.auth);
  }

  /** Fresh ID token (Firebase refreshes it automatically when it expires). */
  async idToken(): Promise<string | null> {
    if (this.demo()) return null;
    return (await this.auth.currentUser?.getIdToken()) ?? null;
  }
}
