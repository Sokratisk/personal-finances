import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

export interface Transaction {
  id?: string;
  description: string;
  /** Positive = income, negative = expense. */
  amount: number;
  category: string;
  /** yyyy-mm-dd */
  date: string;
}

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/api/transactions`;

  list() {
    return this.http.get<Transaction[]>(this.url);
  }

  create(tx: Transaction) {
    return this.http.post<Transaction>(this.url, tx);
  }

  update(id: string, tx: Transaction) {
    return this.http.put<Transaction>(`${this.url}/${id}`, tx);
  }

  remove(id: string) {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
