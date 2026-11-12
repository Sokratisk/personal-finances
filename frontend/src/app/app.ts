import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  styleUrl: './app.scss',
  template: `
    <header>
      <h1>Personal Finances Test deploy</h1>
      @if (auth.user(); as user) {
        <span class="who">{{ user.displayName ?? user.email }}</span>
        <button (click)="auth.signOut()">Sign out</button>
      }
    </header>

    <main>
      @switch (auth.user()) {
        @case (undefined) {
          <p>Loading…</p>
        }
        @case (null) {
          <section class="signin">
            <p>Sign in to see your finances.</p>
            <button (click)="auth.signIn()">Sign in with Google</button>
          </section>
        }
        @default {
          <router-outlet />
        }
      }
    </main>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
}
