import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Transaction, TransactionsService } from '../core/transactions.service';

const today = () => new Date().toISOString().slice(0, 10);

@Component({
  selector: 'app-transactions',
  imports: [FormsModule, CurrencyPipe],
  styleUrl: './transactions.scss',
  template: `
    <section class="summary">
      <div>Income <strong class="pos">{{ income() | currency: 'EUR' }}</strong></div>
      <div>Expenses <strong class="neg">{{ expenses() | currency: 'EUR' }}</strong></div>
      <div>Balance <strong>{{ income() + expenses() | currency: 'EUR' }}</strong></div>
    </section>

    <form (ngSubmit)="add()" class="add">
      <input name="date" type="date" [(ngModel)]="draft.date" required />
      <input name="description" placeholder="Description" [(ngModel)]="draft.description" required />
      <input name="category" placeholder="Category" [(ngModel)]="draft.category" />
      <input name="amount" type="number" step="0.01" placeholder="Amount (-50 = expense)" [(ngModel)]="draft.amount" required />
      <button type="submit">Add</button>
    </form>

    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    <table>
      <thead>
        <tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th><th></th></tr>
      </thead>
      <tbody>
        @for (tx of items(); track tx.id) {
          <tr>
            <td>{{ tx.date }}</td>
            <td>{{ tx.description }}</td>
            <td>{{ tx.category }}</td>
            <td class="num" [class.pos]="tx.amount > 0" [class.neg]="tx.amount < 0">
              {{ tx.amount | currency: 'EUR' }}
            </td>
            <td><button (click)="remove(tx)">✕</button></td>
          </tr>
        } @empty {
          <tr><td colspan="5" class="empty">{{ loading() ? 'Loading…' : 'No transactions yet.' }}</td></tr>
        }
      </tbody>
    </table>
  `,
})
export class Transactions {
  private readonly api = inject(TransactionsService);

  protected readonly items = signal<Transaction[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly income = computed(() =>
    this.items().reduce((s, t) => (t.amount > 0 ? s + t.amount : s), 0),
  );
  protected readonly expenses = computed(() =>
    this.items().reduce((s, t) => (t.amount < 0 ? s + t.amount : s), 0),
  );

  protected draft = this.emptyDraft();

  constructor() {
    this.api.list().subscribe({
      next: (list) => {
        this.items.set(list);
        this.loading.set(false);
      },
      error: (e) => this.fail(e),
    });
  }

  protected add() {
    const tx: Transaction = { ...this.draft, amount: Number(this.draft.amount) };
    this.api.create(tx).subscribe({
      next: (created) => {
        this.items.update((list) =>
          [created, ...list].sort((a, b) => b.date.localeCompare(a.date)),
        );
        this.draft = this.emptyDraft();
        this.error.set(null);
      },
      error: (e) => this.fail(e),
    });
  }

  protected remove(tx: Transaction) {
    if (!tx.id) return;
    this.api.remove(tx.id).subscribe({
      next: () => this.items.update((list) => list.filter((t) => t.id !== tx.id)),
      error: (e) => this.fail(e),
    });
  }

  private emptyDraft(): Transaction {
    return { date: today(), description: '', category: '', amount: 0 };
  }

  private fail(e: { error?: { error?: string }; message?: string }) {
    this.loading.set(false);
    this.error.set(e.error?.error ?? e.message ?? 'Something went wrong');
  }
}
