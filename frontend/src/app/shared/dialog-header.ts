import { Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideX } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';

/**
 * Shared header for form dialogs: [✓ Action] · Title · [✕].
 * With `formId` the action button submits that form (HTML `form` attribute), so the form's own
 * (ngSubmit) runs even though the button sits outside it. Without `formId` it emits `action`.
 * Use with `<hlm-dialog-content [showCloseButton]="false">`. Extra lines (descriptions, controls) go in as content.
 */
@Component({
  selector: 'app-dialog-header',
  imports: [NgIcon, HlmButtonImports, HlmDialogImports],
  providers: [provideIcons({ lucideCheck, lucideX })],
  host: { class: 'grid gap-1.5' },
  template: `
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div class="justify-self-start">
        @if (actionLabel()) {
          <button
            [attr.type]="formId() ? 'submit' : 'button'"
            [attr.form]="formId() || null"
            [disabled]="busy() || disabled()"
            (click)="formId() ? null : action.emit()"
            class="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:opacity-50"
          >
            <ng-icon name="lucideCheck" />
            {{ busy() ? busyLabel() : actionLabel() }}
          </button>
        }
      </div>
      <h2 hlmDialogTitle class="truncate text-center text-base font-semibold">{{ title() }}</h2>
      <div class="justify-self-end">
        <button hlmBtn hlmDialogClose type="button" variant="ghost" size="icon-sm" aria-label="Close">
          <ng-icon name="lucideX" />
        </button>
      </div>
    </div>
    <div class="text-center text-sm text-muted-foreground empty:hidden"><ng-content /></div>
  `,
})
export class DialogHeader {
  readonly title = input.required<string>();
  /** Label of the primary action (e.g. "Add"); omit for no action button. */
  readonly actionLabel = input<string | null>(null);
  /** id of the form the action submits. */
  readonly formId = input<string | null>(null);
  readonly busy = input(false);
  readonly busyLabel = input('Saving…');
  readonly disabled = input(false);
  readonly action = output<void>();
}
