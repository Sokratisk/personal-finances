import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { PwaInstallService } from '../core/pwa-install.service';

/** "Install app" button: native prompt on Android/Chrome/Edge, instructions on iOS. */
@Component({
  selector: 'app-install-button',
  imports: [NgIcon, HlmButtonImports, HlmDialogImports],
  providers: [provideIcons({ lucideDownload })],
  template: `
    @if (pwa.showInstall()) {
      <button hlmBtn size="sm" (click)="onClick()">
        <ng-icon name="lucideDownload" /> Install app
      </button>
    }

    <hlm-dialog [state]="showIosHelp() ? 'open' : 'closed'" (closed)="showIosHelp.set(false)">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-md">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Install on your iPhone</h2>
          <p hlmDialogDescription>Add Personal Finances to your Home Screen.</p>
        </hlm-dialog-header>
        <ol class="list-decimal space-y-2 pl-5 text-sm">
          <li>Open this page in <strong>Safari</strong>.</li>
          <li>
            Tap the <strong>Share</strong> button
            <svg viewBox="0 0 24 24" class="inline size-4 align-[-3px]" aria-hidden="true">
              <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
            in the toolbar.
          </li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        </ol>
        <hlm-dialog-footer>
          <button hlmBtn (click)="showIosHelp.set(false)">Got it</button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class InstallButton {
  protected readonly pwa = inject(PwaInstallService);
  protected readonly showIosHelp = signal(false);

  protected async onClick() {
    const prompted = await this.pwa.install();
    if (!prompted && this.pwa.isIos) this.showIosHelp.set(true);
  }
}
