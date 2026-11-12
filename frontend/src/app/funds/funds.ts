import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArchive, lucideArchiveRestore, lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { ApiService, type ProfileResponse } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { CURRENCY } from '../core/format';
import { round2 } from '../core/ledger';
import type { Fund } from '../core/models';

/** Standalone pots of money (house budget, gift cards…) — outside the monthly cash flow. */
@Component({
  selector: 'app-funds',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, FormsModule, NgIcon, HlmButtonImports, HlmCardImports, HlmInputImports],
  providers: [provideIcons({ lucideArchive, lucideArchiveRestore, lucidePlus, lucideTrash2 })],
  template: `
    <div class="grid gap-6">
      <div>
        <h1 class="text-xl font-semibold">Funds</h1>
        <p class="text-sm text-muted-foreground">Money set aside for one purpose. Not part of your monthly income, expenses or result.</p>
      </div>

      <section hlmCard size="sm">
        <form class="flex flex-wrap gap-2 px-4" (ngSubmit)="create()">
          <input hlmInput name="name" class="min-w-40 flex-1" placeholder="New fund (e.g. Car savings)" [(ngModel)]="newName" />
          <input hlmInput name="initial" type="number" step="0.01" class="w-36" placeholder="Starting amount" [(ngModel)]="newInitial" />
          <button hlmBtn type="submit" [disabled]="!newName.trim()"><ng-icon name="lucidePlus" /> Create</button>
        </form>
      </section>

      <div class="grid gap-4 md:grid-cols-2">
        @for (f of store.funds(); track f.id) {
          <section hlmCard [class.opacity-60]="f.archived">
            <div hlmCardHeader>
              <h2 hlmCardTitle>{{ f.name }}</h2>
              <p class="text-2xl font-semibold tabular-nums" [class.text-red-400]="remaining(f) < 0">{{ remaining(f) | currency: currency }}</p>
              <p hlmCardDescription class="sensitive">
                In {{ totalIn(f) | number: '1.2-2' }} · Out {{ totalOut(f) | number: '1.2-2' }}
              </p>
              <div hlmCardAction class="flex gap-1">
                <button hlmBtn variant="ghost" size="icon-sm" [attr.aria-label]="f.archived ? 'Restore' : 'Archive'" (click)="run(api.updateFund(f.id, { archived: !f.archived }))">
                  <ng-icon [name]="f.archived ? 'lucideArchiveRestore' : 'lucideArchive'" />
                </button>
                @if (!f.entries.length) {
                  <button hlmBtn variant="ghost" size="icon-sm" aria-label="Delete fund" (click)="run(api.deleteFund(f.id))"><ng-icon name="lucideTrash2" /></button>
                }
              </div>
            </div>
            <div hlmCardContent class="grid gap-3">
              <div class="max-h-64 overflow-y-auto rounded-md border text-sm">
                @for (e of f.entries; track e.id) {
                  <div class="flex items-center gap-2 border-b px-3 py-1.5 last:border-0">
                    <span class="w-20 shrink-0 text-xs text-muted-foreground">{{ e.date | date: 'dd MMM yy' }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ e.note || '—' }}</span>
                    <span class="tabular-nums" [class.text-green-500]="e.amount > 0" [class.text-red-400]="e.amount < 0">{{ e.amount | number: '1.2-2' }}</span>
                    <button hlmBtn variant="ghost" size="icon-xs" aria-label="Delete" (click)="run(api.deleteFundEntry(f.id, e.id))"><ng-icon name="lucideTrash2" /></button>
                  </div>
                } @empty {
                  <p class="p-3 text-center text-muted-foreground">No movements yet.</p>
                }
              </div>
              @if (!f.archived) {
                <form class="flex flex-wrap gap-2" (ngSubmit)="addEntry(f)">
                  <input hlmInput name="amount" type="number" step="0.01" class="w-28" placeholder="−50 / +100" [(ngModel)]="draft(f.id).amount" />
                  <input hlmInput name="note" class="min-w-28 flex-1" placeholder="Note" [(ngModel)]="draft(f.id).note" />
                  <input hlmInput name="date" type="date" class="w-36" [(ngModel)]="draft(f.id).date" />
                  <button hlmBtn type="submit" size="sm">Add</button>
                </form>
                <p class="text-xs text-muted-foreground">Negative = money spent from the fund, positive = money added.</p>
              }
            </div>
          </section>
        } @empty {
          <p class="text-muted-foreground">No funds yet.</p>
        }
      </div>
    </div>
  `,
})
export class Funds {
  protected readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);
  protected readonly currency = CURRENCY;
  protected newName = '';
  protected newInitial: number | null = null;

  /** One add-form draft per fund. */
  private readonly drafts: Record<string, { amount: number | null; note: string; date: string }> = {};
  protected draft(id: string) {
    return (this.drafts[id] ??= { amount: null, note: '', date: new Date().toISOString().slice(0, 10) });
  }

  protected remaining = (f: Fund) => round2(f.entries.reduce((s, e) => s + e.amount, 0));
  protected totalIn = (f: Fund) => round2(f.entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0));
  protected totalOut = (f: Fund) => round2(-f.entries.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0));

  protected async run(p: Promise<ProfileResponse>) {
    try {
      this.store.applyProfile(await p);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  protected async create() {
    await this.run(this.api.addFund(this.newName.trim(), this.newInitial ? Number(this.newInitial) : undefined));
    this.newName = '';
    this.newInitial = null;
  }

  protected async addEntry(f: Fund) {
    const d = this.draft(f.id)!;
    const amount = Number(d.amount);
    if (!amount) {
      toast.error('Enter an amount');
      return;
    }
    await this.run(this.api.addFundEntry(f.id, { amount, note: d.note.trim() || undefined, date: d.date }));
    d.amount = null;
    d.note = '';
  }
}
