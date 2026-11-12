import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { AuthService } from './core/auth.service';
import { InstallButton } from './install-button/install-button';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, InstallButton],
  styleUrl: './app.scss',
  template: `
    <header>
      <h1>Personal Finances</h1>
      <app-install-button />
      @if (updateReady()) {
        <button (click)="reload()">New version · Reload</button>
      }
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
  protected readonly updateReady = signal(false);

  constructor() {
    // Installed apps keep running the cached version; offer a reload once a new deploy is downloaded.
    const sw = inject(SwUpdate);
    if (sw.isEnabled) {
      sw.versionUpdates.subscribe((e) => {
        if (e.type === 'VERSION_READY') this.updateReady.set(true);
      });
    }
  }

  protected reload() {
    document.location.reload();
  }
}
