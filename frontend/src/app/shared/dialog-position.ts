import { createGlobalPositionStrategy, type PositionStrategy } from '@angular/cdk/overlay';
import { type Injector, type Signal, computed } from '@angular/core';

/** Below Tailwind's `sm` breakpoint. */
const isPhone = () => window.matchMedia?.('(max-width: 639px)').matches ?? false;

/**
 * Dialog position for forms with text inputs: pinned near the top on phones so the on-screen
 * keyboard doesn't cover the form; default (centred) elsewhere.
 *
 * A strategy can't be reused after its dialog closes, so a fresh one is made every time `open` turns true.
 * Bind it as `<hlm-dialog [positionStrategy]="pos()">`.
 */
export function topOnPhone(injector: Injector, open: Signal<unknown>): Signal<PositionStrategy | null> {
  return computed(() => {
    if (!open() || !isPhone()) return null;
    return createGlobalPositionStrategy(injector).centerHorizontally().top('calc(env(safe-area-inset-top) + 12px)');
  });
}
