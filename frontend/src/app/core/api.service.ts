import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Entry, ItemSummary, Kind, Profile, YearData, YearDoc } from './models';

export interface ProfileResponse {
  profile: Profile;
  serviceAccountEmail: string | null;
}
export type YearResponse = { year: YearDoc };
export type MonthsResponse = { months: Record<number, Entry[]>; year?: YearDoc };

/** Thin typed wrapper around the Hono API. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api`;

  private run<T>(o: Observable<T>) {
    return firstValueFrom(o);
  }
  private get<T>(path: string) {
    return this.run(this.http.get<T>(this.base + path));
  }
  private post<T>(path: string, body: unknown = {}) {
    return this.run(this.http.post<T>(this.base + path, body));
  }
  private put<T>(path: string, body: unknown) {
    return this.run(this.http.put<T>(this.base + path, body));
  }
  private patch<T>(path: string, body: unknown) {
    return this.run(this.http.patch<T>(this.base + path, body));
  }
  private delete<T>(path: string) {
    return this.run(this.http.delete<T>(this.base + path));
  }

  // profile & settings
  profile = () => this.get<ProfileResponse>('/profile');
  saveSettings = (sheetId: string | null) => this.put<ProfileResponse>('/settings', { sheetId });
  syncNow = () => this.post<ProfileResponse>('/sync');

  // accounts
  addAccount = (name: string) => this.post<ProfileResponse>('/accounts', { name });
  updateAccount = (id: string, patch: { name?: string; archived?: boolean }) => this.patch<ProfileResponse>(`/accounts/${id}`, patch);
  moveAccount = (id: string, direction: 'up' | 'down') => this.post<ProfileResponse>(`/accounts/${id}/move`, { direction });

  // funds
  addFund = (name: string, initial?: number) => this.post<ProfileResponse>('/funds', { name, initial });
  updateFund = (id: string, patch: { name?: string; archived?: boolean }) => this.patch<ProfileResponse>(`/funds/${id}`, patch);
  deleteFund = (id: string) => this.delete<ProfileResponse>(`/funds/${id}`);
  addFundEntry = (id: string, e: { amount: number; note?: string; date?: string }) => this.post<ProfileResponse>(`/funds/${id}/entries`, e);
  deleteFundEntry = (id: string, entryId: string) => this.delete<ProfileResponse>(`/funds/${id}/entries/${entryId}`);

  // years
  year = (y: number) => this.get<YearData>(`/years/${y}`);
  createYear = (b: { year: number; opening: number; copyFrom?: number; categoryIds?: string[] }) =>
    this.post<YearResponse & ProfileResponse>('/years', b);
  setOpening = (y: number, opening: number) => this.patch<YearResponse>(`/years/${y}`, { opening });

  // categories
  addCategory = (y: number, b: { name: string; kind: Kind; group?: string }) => this.post<YearResponse>(`/years/${y}/categories`, b);
  updateCategory = (y: number, id: string, patch: { name?: string; group?: string; kind?: Kind; archived?: boolean }) =>
    this.patch<YearResponse>(`/years/${y}/categories/${id}`, patch);
  moveCategory = (y: number, id: string, direction: 'up' | 'down') => this.post<YearResponse>(`/years/${y}/categories/${id}/move`, { direction });
  deleteCategory = (y: number, id: string) => this.delete<YearResponse & { archived: boolean }>(`/years/${y}/categories/${id}`);

  // items
  allItems = () => this.get<{ items: ItemSummary[] }>('/items');
  addItem = (y: number, b: { categoryId: string; name: string; month?: number }) => this.post<YearResponse>(`/years/${y}/items`, b);
  updateItem = (y: number, id: string, patch: { name?: string; month?: number | null }) => this.patch<YearResponse>(`/years/${y}/items/${id}`, patch);
  deleteItem = (y: number, id: string) => this.delete<YearResponse>(`/years/${y}/items/${id}`);

  // entries
  addEntry = (y: number, m: number, b: { categoryId: string; itemId?: string; amount: number; note?: string }) =>
    this.post<MonthsResponse>(`/years/${y}/months/${m}/entries`, b);
  updateEntry = (y: number, m: number, id: string, patch: Partial<Omit<Entry, 'id' | 'itemId'>> & { itemId?: string | null; month?: number }) =>
    this.patch<MonthsResponse>(`/years/${y}/months/${m}/entries/${id}`, patch);
  deleteEntry = (y: number, m: number, id: string) => this.delete<MonthsResponse>(`/years/${y}/months/${m}/entries/${id}`);
  setUntraced = (y: number, m: number, amount: number) => this.put<MonthsResponse>(`/years/${y}/months/${m}/untraced`, { amount });

  // monthly count
  saveCount = (y: number, m: number, b: { balances: Record<string, number | null>; stocksValue?: number | null }) =>
    this.put<YearResponse>(`/years/${y}/counts/${m}`, b);
}
