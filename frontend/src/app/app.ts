import { Component, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendarDays,
  lucideEye,
  lucideEyeOff,
  lucideLayoutDashboard,
  lucideList,
  lucideLogOut,
  lucideMenu,
  lucidePiggyBank,
  lucidePlane,
  lucideRefreshCw,
  lucideSettings,
  lucideTags,
  lucideX,
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
    provideIcons({ lucideCalendarDays, lucideEye, lucideEyeOff, lucideLayoutDashboard, lucideList, lucideLogOut, lucideMenu, lucidePiggyBank, lucidePlane, lucideRefreshCw, lucideSettings, lucideTags, lucideX }),
  ],
  template: `
    <header class="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      @if (auth.demo()) {
        <div class="flex items-center justify-center gap-3 bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">
          <span>Demo mode — sample data, nothing you change is saved.</span>
          <button type="button" class="underline underline-offset-2" (click)="auth.signOut()">Exit demo</button>
        </div>
      }
      <div class="mx-auto w-full max-w-[1920px] px-4 lg:px-8 flex items-center gap-2 py-2.5">
        <a routerLink="/" class="flex shrink-0 items-center gap-2 font-semibold">
          <img src="icons/icon.svg" alt="" class="size-7 rounded-md" />
          <span class="lg:hidden xl:inline">Personal Finances</span>
        </a>

        <!-- Desktop: navigation on the same line -->
        @if (auth.user()) {
          <nav class="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Main">
            @for (l of links; track l.path) {
              <a hlmBtn variant="ghost" size="sm" [routerLink]="l.path" routerLinkActive="bg-muted text-foreground"
                 [routerLinkActiveOptions]="{ exact: l.path === '/' }" class="text-muted-foreground">
                <ng-icon [name]="l.icon" /> {{ l.label }}
              </a>
            }
          </nav>
        }

        <div class="ml-auto flex items-center gap-1.5">
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
          @if (updateReady()) {
            <button hlmBtn variant="outline" size="sm" (click)="reload()"><ng-icon name="lucideRefreshCw" /> Update</button>
          }
          <!-- Desktop-only extras (they live in the menu on smaller screens) -->
          <div class="hidden items-center gap-1.5 lg:flex">
            <app-install-button />
            @if (auth.user(); as user) {
              <span class="hidden max-w-48 truncate text-sm text-muted-foreground 2xl:inline">{{ user.displayName ?? user.email }}</span>
              <button hlmBtn variant="ghost" size="sm" (click)="auth.signOut()" [attr.aria-label]="auth.demo() ? 'Exit demo' : 'Sign out'">
                <ng-icon name="lucideLogOut" /> {{ auth.demo() ? 'Exit demo' : 'Sign out' }}
              </button>
            }
          </div>
          @if (auth.user()) {
            <button hlmBtn variant="ghost" size="icon" class="lg:hidden" aria-label="Open menu" [attr.aria-expanded]="menuOpen()"
                    (click)="menuOpen.set(true)">
              <ng-icon name="lucideMenu" class="text-xl" />
            </button>
          } @else {
            <div class="lg:hidden"><app-install-button /></div>
          }
        </div>
      </div>
    </header>

    <!-- Phone/tablet menu: slides in from the right -->
    @if (menuOpen()) {
      <div class="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
        <div class="absolute inset-0 bg-black/60" (click)="menuOpen.set(false)"></div>
        <nav class="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col gap-1 border-l bg-background p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-xl"
             aria-label="Main">
          <div class="mb-2 flex items-center justify-between px-2">
            <span class="font-semibold">Menu</span>
            <button hlmBtn variant="ghost" size="icon-sm" aria-label="Close menu" (click)="menuOpen.set(false)">
              <ng-icon name="lucideX" />
            </button>
          </div>
          @for (l of links; track l.path) {
            <a [routerLink]="l.path" routerLinkActive="bg-muted text-foreground" [routerLinkActiveOptions]="{ exact: l.path === '/' }"
               class="flex items-center gap-3 rounded-md px-3 py-2.5 text-muted-foreground hover:bg-muted" (click)="menuOpen.set(false)">
              <ng-icon [name]="l.icon" class="text-lg" /> {{ l.label }}
            </a>
          }
          <div class="mt-auto grid gap-2 border-t pt-3">
            <app-install-button />
            @if (auth.user(); as user) {
              <p class="truncate px-3 text-xs text-muted-foreground">{{ user.displayName ?? user.email }}</p>
              <button hlmBtn variant="outline" (click)="menuOpen.set(false); auth.signOut()">
                <ng-icon name="lucideLogOut" /> {{ auth.demo() ? 'Exit demo' : 'Sign out' }}
              </button>
            }
          </div>
        </nav>
      </div>
    }


    <main class="mx-auto w-full max-w-[1920px] px-4 lg:px-8 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
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
            <div class="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <span class="h-px flex-1 bg-border"></span>or<span class="h-px flex-1 bg-border"></span>
            </div>
            <button hlmBtn size="lg" variant="outline" (click)="auth.startDemo()">Try the demo</button>
            <p class="mt-2 text-xs text-muted-foreground">Explore with sample data. Nothing is saved and no account is needed.</p>
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
  /** Phone/tablet navigation menu. */
  protected readonly menuOpen = signal(false);

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
    // Close the menu after navigating, and on Escape.
    inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.menuOpen.set(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.menuOpen.set(false);
    });

    // Shareable demo link: personal-finances.net/?demo
    if (new URLSearchParams(location.search).has('demo')) {
      this.auth.startDemo();
      history.replaceState(null, '', location.pathname);
    }

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
