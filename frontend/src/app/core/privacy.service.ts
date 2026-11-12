import { Injectable, effect, signal } from '@angular/core';

const KEY = 'pf-privacy';

/**
 * Privacy mode: blurs all amounts (see `.privacy` rules in styles.css) so the app can be shown
 * to someone. Remembered per device; storage can be unavailable (private mode), so it's best-effort.
 */
@Injectable({ providedIn: 'root' })
export class PrivacyService {
  readonly enabled = signal(read());

  constructor() {
    effect(() => {
      const on = this.enabled();
      document.documentElement.classList.toggle('privacy', on);
      try {
        localStorage.setItem(KEY, on ? '1' : '0');
      } catch {
        /* storage unavailable — keep it for this session only */
      }
    });
  }

  toggle() {
    this.enabled.update((v) => !v);
  }
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
