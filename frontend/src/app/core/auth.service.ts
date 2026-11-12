import { Injectable, signal } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = getAuth(initializeApp(environment.firebase));

  /** `undefined` while Firebase restores the session, `null` when signed out. */
  readonly user = signal<User | null | undefined>(undefined);

  constructor() {
    onAuthStateChanged(this.auth, (u) => this.user.set(u));
  }

  signIn() {
    return signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  signOut() {
    return signOut(this.auth);
  }

  /** Fresh ID token (Firebase refreshes it automatically when it expires). */
  async idToken(): Promise<string | null> {
    return (await this.auth.currentUser?.getIdToken()) ?? null;
  }
}
