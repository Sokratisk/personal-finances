import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideExternalLink, lucideRefreshCw } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { FinanceStore, errorMessage } from '../core/finance.store';

/** Optional, per-user Google Sheet mirror. */
@Component({
  selector: 'app-settings',
  imports: [DatePipe, FormsModule, NgIcon, HlmButtonImports, HlmCardImports, HlmInputImports, HlmLabelImports],
  providers: [provideIcons({ lucideCopy, lucideExternalLink, lucideRefreshCw })],
  template: `
    <div class="mx-auto grid max-w-2xl gap-6">
      <h1 class="text-xl font-semibold">Settings</h1>

      <section hlmCard>
        <div hlmCardHeader>
          <h2 hlmCardTitle>Google Sheet mirror</h2>
          <p hlmCardDescription>
            Optional. After every change the app rewrites a Google Sheet with one tab per year (same layout as a
            budget sheet, with real formulas) plus a Funds tab. The sheet is read-only for you — edits there are overwritten.
          </p>
        </div>
        <div hlmCardContent class="grid gap-4">
          @if (auth.demo()) {
            <p class="rounded-md border border-primary/40 p-3 text-sm">Not available in the demo — sign in with Google to link your own sheet.</p>
          }
          <ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Create an empty sheet at <a class="underline" href="https://sheets.new" target="_blank" rel="noopener">sheets.new</a>.</li>
            <li>
              Share it as <strong>Editor</strong> with:
              @if (store.serviceAccountEmail(); as email) {
                <span class="mt-1 flex items-center gap-1">
                  <code class="rounded bg-muted px-1.5 py-0.5 text-xs break-all text-foreground">{{ email }}</code>
                  <button hlmBtn variant="ghost" size="icon-xs" aria-label="Copy email" (click)="copy(email)"><ng-icon name="lucideCopy" /></button>
                </span>
              }
            </li>
            <li>Paste the sheet's link or ID below.</li>
          </ol>

          <form class="flex flex-wrap items-end gap-2" (ngSubmit)="save()">
            <div class="grid min-w-60 flex-1 gap-1.5">
              <label hlmLabel for="sheet">Sheet link or ID</label>
              <input hlmInput id="sheet" name="sheet" [(ngModel)]="sheetInput" placeholder="https://docs.google.com/spreadsheets/d/…" />
            </div>
            <button hlmBtn type="submit" [disabled]="busy()">Save</button>
            @if (store.profile()?.sheetId) {
              <button hlmBtn type="button" variant="outline" [disabled]="busy()" (click)="unlink()">Unlink</button>
            }
          </form>

          @if (store.profile()?.sheetId; as id) {
            <div class="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm">
              <span class="flex-1">
                @if (store.profile()?.lastSync; as s) {
                  @if (s.ok) {
                    <span class="text-green-500">✓ Synced</span> {{ s.at | date: 'medium' }}
                  } @else {
                    <span class="text-red-400">✗ Last sync failed:</span> {{ s.error }}
                  }
                } @else {
                  Not synced yet.
                }
              </span>
              <button hlmBtn size="sm" variant="outline" [disabled]="busy()" (click)="syncNow()">
                <ng-icon name="lucideRefreshCw" [class.animate-spin]="busy()" /> Sync now
              </button>
              <a hlmBtn size="sm" variant="ghost" [href]="'https://docs.google.com/spreadsheets/d/' + id" target="_blank" rel="noopener">
                <ng-icon name="lucideExternalLink" /> Open
              </a>
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class Settings {
  private readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);
  protected readonly auth = inject(AuthService);
  protected readonly busy = signal(false);
  protected readonly sheetInput = signal('');

  constructor() {
    effect(() => this.sheetInput.set(this.store.profile()?.sheetId ?? ''));
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected save() {
    return this.act(async () => {
      this.store.applyProfile(await this.api.saveSettings(this.sheetInput().trim() || null));
      this.sheetInput.set(this.store.profile()?.sheetId ?? '');
      toast.success(this.sheetInput() ? 'Sheet linked — first sync is running' : 'Sheet unlinked');
    });
  }

  protected unlink() {
    this.sheetInput.set('');
    return this.save();
  }

  protected syncNow() {
    return this.act(async () => {
      this.store.applyProfile(await this.api.syncNow());
      const s = this.store.profile()?.lastSync;
      if (s?.ok) toast.success('Sheet updated');
      else toast.error(s?.error ?? 'Sync failed');
    });
  }

  protected async copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  }
}
