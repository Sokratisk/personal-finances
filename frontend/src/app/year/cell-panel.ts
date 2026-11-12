import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { entriesFor, round2 } from '../core/ledger';
import type { Entry } from '../core/models';
import { EntryEditor } from './entry-editor';

/** The amounts behind one category × month cell, with add / edit / delete. */
@Component({
  selector: 'app-cell-panel',
  imports: [DecimalPipe, NgIcon, HlmBadgeImports, HlmButtonImports, EntryEditor],
  providers: [provideIcons({ lucidePencil, lucideTrash2 })],
  template: `
    <div class="grid gap-4">
      <div class="max-h-72 overflow-y-auto rounded-md border">
        @for (e of entries(); track e.id) {
          <div class="flex items-center gap-2 border-b px-3 py-2 last:border-0" [class.bg-muted]="editing()?.id === e.id">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">{{ e.note || '—' }}</p>
              @if (itemName(e); as name) {
                <span hlmBadge variant="secondary" class="mt-0.5">{{ name }}</span>
              }
            </div>
            <span class="tabular-nums" [class.text-red-400]="e.amount < 0">{{ e.amount | number: '1.2-2' }}</span>
            <button hlmBtn variant="ghost" size="icon-sm" aria-label="Edit" (click)="editing.set(e)">
              <ng-icon name="lucidePencil" />
            </button>
            <button hlmBtn variant="ghost" size="icon-sm" aria-label="Delete" (click)="remove(e)">
              <ng-icon name="lucideTrash2" />
            </button>
          </div>
        } @empty {
          <p class="p-4 text-center text-sm text-muted-foreground">No amounts yet.</p>
        }
      </div>
      <p class="flex justify-between text-sm font-medium">
        <span>Total</span><span class="tabular-nums">€{{ total() | number: '1.2-2' }}</span>
      </p>

      <div class="border-t pt-4">
        <p class="mb-3 text-sm font-medium">{{ editing() ? 'Edit amount' : 'Add amount' }}</p>
        <app-entry-editor [categoryId]="categoryId()" [initialMonth]="month()" [entry]="editing()"
                          (saved)="editing.set(null)" (cancelled)="editing.set(null)" />
      </div>
    </div>
  `,
})
export class CellPanel {
  private readonly api = inject(ApiService);
  private readonly store = inject(FinanceStore);

  readonly categoryId = input.required<string>();
  readonly month = input.required<number>();

  protected readonly editing = signal<Entry | null>(null);
  protected readonly entries = computed(() => {
    const d = this.store.data();
    return d ? entriesFor(d, this.categoryId(), this.month()) : [];
  });
  protected readonly total = computed(() => round2(this.entries().reduce((s, e) => s + e.amount, 0)));

  protected itemName(e: Entry) {
    return e.itemId ? this.store.items().find((i) => i.id === e.itemId)?.name : undefined;
  }

  protected async remove(e: Entry) {
    try {
      this.store.applyMonths(await this.api.deleteEntry(this.store.y, this.month(), e.id));
      if (this.editing()?.id === e.id) this.editing.set(null);
      toast.success('Deleted', {
        action: { label: 'Undo', onClick: () => void this.restore(e) },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  private async restore(e: Entry) {
    const { id: _id, ...rest } = e;
    this.store.applyMonths(await this.api.addEntry(this.store.y, this.month(), rest));
  }
}
