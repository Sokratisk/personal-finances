import { Component, inject, signal } from '@angular/core';
import { PwaInstallService } from '../core/pwa-install.service';

/** "Install app" button: native prompt on Android/Chrome/Edge, instructions on iOS. */
@Component({
  selector: 'app-install-button',
  styleUrl: './install-button.scss',
  template: `
    @if (pwa.showInstall()) {
      <button class="install" (click)="onClick()">Install app</button>
    }

    @if (showIosHelp()) {
      <div class="backdrop" (click)="showIosHelp.set(false)">
        <div class="sheet" role="dialog" aria-label="Install on iPhone" (click)="$event.stopPropagation()">
          <h2>Install on your iPhone</h2>
          <ol>
            <li>Open this page in <strong>Safari</strong>.</li>
            <li>
              Tap the <strong>Share</strong> button
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" />
              </svg>
              in the toolbar.
            </li>
            <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          </ol>
          <button (click)="showIosHelp.set(false)">Got it</button>
        </div>
      </div>
    }
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
