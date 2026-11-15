import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { monthName } from '../core/format';

/**
 * Shown after amounts change in a counted (closed) month. The count is what was really in the
 * accounts, so it never changes — instead we offer to update that month's untraced correction.
 */
@Component({
  selector: 'app-untraced-prompt',
  imports: [DecimalPipe, NgIcon, HlmButtonImports, HlmDialogImports],
  providers: [provideIcons({ lucideTriangleAlert })],
  template: `
    <hlm-dialog [state]="prompt() ? 'open' : 'closed'" (closed)="dismiss()">
      <hlm-dialog-content *hlmDialogPortal class="sm:max-w-md">
        @if (prompt(); as p) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>Update {{ monthName(p.month) }}'s untraced?</h2>
            <p hlmDialogDescription>
              {{ monthName(p.month) }} {{ p.year }} is counted. Its count stays as it is (it's what was really in your accounts),
              so the untraced correction should change to keep the month matching.
            </p>
          </hlm-dialog-header>

          <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg bg-muted p-4 text-center">
            <div>
              <p class="text-xs text-muted-foreground">Untraced now</p>
              <p class="text-xl font-semibold tabular-nums">€{{ p.from | number: '1.2-2' }}</p>
            </div>
            <span class="text-muted-foreground" aria-hidden="true">→</span>
            <div>
              <p class="text-xs text-muted-foreground">Should be</p>
              <p class="text-xl font-semibold tabular-nums text-primary">€{{ p.to | number: '1.2-2' }}</p>
            </div>
          </div>

          @if (large()) {
            <p class="flex gap-2 rounded-md border border-destructive/40 p-3 text-sm">
              <ng-icon name="lucideTriangleAlert" class="mt-0.5 shrink-0 text-destructive" />
              <span>That's a large untraced amount. Double-check the amount you just entered and its month.</span>
            </p>
          }

          <div class="flex flex-wrap gap-2">
            <button hlmBtn class="flex-1" [disabled]="saving()" (click)="apply()">
              Update to <span class="sensitive">€{{ p.to | number: '1.2-2' }}</span>
            </button>
            <button hlmBtn variant="outline" class="flex-1" [disabled]="saving()" (click)="dismiss()">Keep as is</button>
          </div>
          @if (store.untracedPrompts().length > 1) {
            <p class="text-center text-xs text-muted-foreground">{{ store.untracedPrompts().length - 1 }} more month(s) to review after this.</p>
          }
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class UntracedPrompt {
  private readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);
  protected readonly monthName = monthName;
  protected readonly saving = signal(false);

  protected readonly prompt = computed(() => this.store.untracedPrompts()[0] ?? null);
  protected readonly large = computed(() => Math.abs(this.prompt()?.to ?? 0) >= 50);

  protected async apply() {
    const p = this.prompt();
    if (!p) return;
    this.saving.set(true);
    try {
      this.store.applyMonths(await this.api.setUntraced(p.year, p.month, p.to));
      toast.success(`${monthName(p.month)} untraced updated to ${p.to.toFixed(2)}`);
      this.store.untracedPrompts.update((list) => list.slice(1));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected dismiss() {
    if (this.saving()) return;
    this.store.untracedPrompts.update((list) => list.slice(1));
  }
}
