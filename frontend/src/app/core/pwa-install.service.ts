import { Injectable, computed, signal } from '@angular/core';

/** Chrome/Edge/Samsung Internet event that lets us show the native install prompt. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Registered at module load (before Angular bootstraps): the browser can fire
// `beforeinstallprompt` very early, and it only fires once per page load.
const deferredPrompt = signal<BeforeInstallPromptEvent | null>(null);
const installed = signal(false);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the event so our own button can trigger it
    deferredPrompt.set(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    installed.set(true);
    deferredPrompt.set(null);
  });
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  /** Already running as an installed app (home-screen icon). */
  readonly isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  /** iPhone/iPad: no install API, the user must use Share → Add to Home Screen. */
  readonly isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /** The browser offered a native install prompt. */
  readonly canPrompt = computed(() => deferredPrompt() !== null);

  /** Whether to show the "Install app" button at all. */
  readonly showInstall = computed(
    () => !this.isStandalone && !installed() && (this.canPrompt() || this.isIos),
  );

  /** Shows the native prompt. Returns false when it isn't available (e.g. iOS). */
  async install(): Promise<boolean> {
    const e = deferredPrompt();
    if (!e) return false;
    deferredPrompt.set(null); // a prompt event can only be used once
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') installed.set(true);
    return true;
  }
}
