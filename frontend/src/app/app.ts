import { Component, effect, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarDays,
  lucideEye,
  lucideEyeOff,
  lucideLayoutDashboard,
  lucideList,
  lucideLogOut,
  lucidePiggyBank,
  lucidePlane,
  lucideRefreshCw,
  lucideSettings,
  lucideTags,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';
import { AuthService } from './core/auth.service';
import { FinanceStore } from './core/finance.store';
import { PrivacyService } from './core/privacy.service';
import { InstallButton } from './install-button/install-button';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIcon, HlmButtonImports, HlmToasterImports, InstallButton],
  providers: [
    provideIcons({ lucideCalendarDays, lucideEye, lucideEyeOff, lucideLayoutDashboard, lucideList, lucideLogOut, lucidePiggyBank, lucidePlane, lucideRefreshCw, lucideSettings, lucideTags }),
  ],
  template: `
    <header class="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
        <a routerLink="/" class="mr-auto flex items-center gap-2 font-semibold">
          <img src="icons/icon.svg" alt="" class="size-7 rounded-md" />
          <span class="hidden sm:inline">Personal Finances</span>
        </a>

        @if (auth.user() && store.years().length) {
          <select aria-label="Year" class="h-8 rounded-md border bg-background px-2 text-sm"
                  [value]="store.selectedYear()" (change)="store.selectYear(+$any($event.target).value)">
            @for (y of store.years(); track y) {
              <option [value]="y" [selected]="y === store.selectedYear()">{{ y }}</option>
            }
          </select>
        }
        @if (auth.user()) {
          <button hlmBtn variant="ghost" size="icon-sm" (click)="privacy.toggle()"
                  [attr.aria-label]="privacy.enabled() ? 'Show amounts' : 'Hide amounts'"
                  [attr.aria-pressed]="privacy.enabled()"
                  [title]="privacy.enabled() ? 'Show amounts' : 'Hide amounts (privacy mode)'">
            <ng-icon [name]="privacy.enabled() ? 'lucideEyeOff' : 'lucideEye'" />
          </button>
        }
        <app-install-button />
        @if (updateReady()) {
          <button hlmBtn variant="outline" size="sm" (click)="reload()"><ng-icon name="lucideRefreshCw" /> Update</button>
        }
        @if (auth.user(); as user) {
          <span class="hidden text-sm text-muted-foreground md:inline">{{ user.displayName ?? user.email }}</span>
          <button hlmBtn variant="ghost" size="sm" (click)="auth.signOut()" aria-label="Sign out">
            <ng-icon name="lucideLogOut" /> <span class="hidden sm:inline">Sign out</span>
          </button>
        }
      </div>

      @if (auth.user()) {
        <nav class="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          @for (l of links; track l.path) {
            <a hlmBtn variant="ghost" size="sm" [routerLink]="l.path" routerLinkActive="bg-muted"
               [routerLinkActiveOptions]="{ exact: l.path === '/' }">
              <ng-icon [name]="l.icon" /> {{ l.label }}
            </a>
          }
        </nav>
      }
    </header>

    <main class="mx-auto max-w-7xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      @switch (auth.user()) {
        @case (undefined) {
          <p class="text-muted-foreground">Loading…</p>
        }
        @case (null) {
          <section class="mx-auto mt-16 max-w-sm text-center">
            <img src="icons/icon.svg" alt="" class="mx-auto mb-4 size-16 rounded-2xl" />
            <h1 class="mb-2 text-2xl font-semibold">Personal Finances</h1>
            <p class="mb-6 text-muted-foreground">Sign in to see your finances.</p>
            <button hlmBtn size="lg" (click)="auth.signIn()">Sign in with Google</button>
          </section>
        }
        @default {
          @if (store.error(); as err) {
            <p class="mb-4 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{{ err }}</p>
          }
          <router-outlet />
        }
      }
    </main>

    <hlm-toaster position="bottom-center" theme="dark" richColors />
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(FinanceStore);
  protected readonly privacy = inject(PrivacyService);
  protected readonly updateReady = signal(false);

  protected readonly links = [
    { path: '/', label: 'Year', icon: 'lucideCalendarDays' },
    { path: '/dashboard', label: 'Dashboard', icon: 'lucideLayoutDashboard' },
    { path: '/trips', label: 'Trips', icon: 'lucidePlane' },
    { path: '/entries', label: 'Entries', icon: 'lucideList' },
    { path: '/funds', label: 'Funds', icon: 'lucidePiggyBank' },
    { path: '/categories', label: 'Categories', icon: 'lucideTags' },
    { path: '/settings', label: 'Settings', icon: 'lucideSettings' },
  ];

  constructor() {
    // Load data once signed in; clear it on sign-out.
    effect(() => {
      const user = this.auth.user();
      if (user) void this.store.init(user.uid);
      else if (user === null) this.store.reset();
    });

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
