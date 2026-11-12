import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArchive, lucideArchiveRestore, lucideCheck, lucideChevronDown, lucideChevronUp, lucidePencil, lucidePlus, lucideTrash2, lucideX } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { ApiService, type ProfileResponse, type YearResponse } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { MONTH_SHORT } from '../core/format';
import { groupExpenses } from '../core/ledger';
import type { Category, Kind } from '../core/models';

@Component({
  selector: 'app-categories',
  imports: [FormsModule, NgIcon, HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmInputImports, HlmNativeSelectImports],
  providers: [provideIcons({ lucideArchive, lucideArchiveRestore, lucideCheck, lucideChevronDown, lucideChevronUp, lucidePencil, lucidePlus, lucideTrash2, lucideX })],
  template: `
    @if (store.data(); as d) {
      <div class="grid gap-6">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold">Categories · {{ d.year.year }}</h1>
            <p class="text-sm text-muted-foreground">Each year has its own categories. Ones with amounts are archived instead of deleted.</p>
          </div>
          <form class="flex items-center gap-2" (ngSubmit)="saveOpening()">
            <label for="opening" class="text-sm text-muted-foreground">From {{ d.year.year - 1 }} (€)</label>
            <input hlmInput id="opening" name="opening" type="number" step="0.01" class="w-32 text-right" [(ngModel)]="opening" />
            <button hlmBtn size="sm" variant="outline" type="submit">Save</button>
          </form>
        </div>

        <!-- Add category -->
        <section hlmCard size="sm">
          <form class="flex flex-wrap items-center gap-2 px-4" (ngSubmit)="addCategory()">
            <input hlmInput name="name" class="min-w-40 flex-1" placeholder="New category name" [(ngModel)]="newName" required />
            <hlm-native-select class="w-32" name="kind" [(ngModel)]="newKind">
              <option hlmNativeSelectOption value="expense">Expense</option>
              <option hlmNativeSelectOption value="income">Income</option>
              <option hlmNativeSelectOption value="stocks">Stocks</option>
            </hlm-native-select>
            @if (newKind === 'expense') {
              <input hlmInput name="group" list="groups" class="w-44" placeholder="Group" [(ngModel)]="newGroup" />
            }
            <button hlmBtn type="submit" [disabled]="!newName.trim()"><ng-icon name="lucidePlus" /> Add</button>
          </form>
          <datalist id="groups">
            @for (g of store.groupNames(); track g) { <option [value]="g"></option> }
          </datalist>
        </section>

        @for (section of sections(); track section.label) {
          <section hlmCard class="gap-0 py-0">
            <p class="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ section.label }}</p>
            @for (c of section.categories; track c.id) {
              <div class="border-t px-4 py-2">
                <div class="flex flex-wrap items-center gap-2">
                  @if (editing() === c.id) {
                    <input hlmInput class="h-8 min-w-36 flex-1" [(ngModel)]="editName" (keyup.enter)="saveEdit(c)" />
                    @if (c.kind === 'expense') {
                      <input hlmInput class="h-8 w-44" list="groups" placeholder="Group" [(ngModel)]="editGroup" (keyup.enter)="saveEdit(c)" />
                    }
                    <button hlmBtn size="icon-sm" aria-label="Save" (click)="saveEdit(c)"><ng-icon name="lucideCheck" /></button>
                    <button hlmBtn size="icon-sm" variant="ghost" aria-label="Cancel" (click)="editing.set(null)"><ng-icon name="lucideX" /></button>
                  } @else {
                    <span class="flex-1 text-sm" [class.text-muted-foreground]="c.archived">
                      {{ c.name }}
                      @if (c.archived) { <span hlmBadge variant="outline" class="ml-1">archived</span> }
                      @if (c.role === 'untraced') { <span hlmBadge variant="secondary" class="ml-1">monthly count</span> }
                      @if (itemCount(c.id)) { <span hlmBadge variant="secondary" class="ml-1">{{ itemCount(c.id) }} items</span> }
                    </span>
                    <button hlmBtn variant="ghost" size="xs" (click)="toggleItems(c.id)">Items</button>
                    <button hlmBtn variant="ghost" size="icon-sm" aria-label="Move up" (click)="run(api.moveCategory(y, c.id, 'up'))"><ng-icon name="lucideChevronUp" /></button>
                    <button hlmBtn variant="ghost" size="icon-sm" aria-label="Move down" (click)="run(api.moveCategory(y, c.id, 'down'))"><ng-icon name="lucideChevronDown" /></button>
                    <button hlmBtn variant="ghost" size="icon-sm" aria-label="Rename" (click)="startEdit(c)"><ng-icon name="lucidePencil" /></button>
                    @if (c.archived) {
                      <button hlmBtn variant="ghost" size="icon-sm" aria-label="Restore" (click)="run(api.updateCategory(y, c.id, { archived: false }))"><ng-icon name="lucideArchiveRestore" /></button>
                    } @else {
                      <button hlmBtn variant="ghost" size="icon-sm" aria-label="Remove" (click)="remove(c)"><ng-icon name="lucideTrash2" /></button>
                    }
                  }
                </div>

                @if (openItems() === c.id) {
                  <div class="mt-2 ml-4 grid gap-1 border-l pl-3">
                    @for (i of itemsOf(c.id); track i.id) {
                      <div class="flex items-center gap-2 text-sm">
                        <span class="flex-1">{{ i.name }}</span>
                        <span class="text-xs text-muted-foreground">{{ i.month ? monthShort[i.month - 1] : '' }}</span>
                        <button hlmBtn variant="ghost" size="icon-xs" aria-label="Rename item" (click)="renameItem(i.id, i.name)"><ng-icon name="lucidePencil" /></button>
                        <button hlmBtn variant="ghost" size="icon-xs" aria-label="Delete item" (click)="run(api.deleteItem(y, i.id))"><ng-icon name="lucideTrash2" /></button>
                      </div>
                    }
                    <form class="flex gap-2 pt-1" (ngSubmit)="addItem(c.id)">
                      <input hlmInput name="itemName" class="h-8 flex-1" placeholder="New item (e.g. a trip)" [(ngModel)]="newItem" />
                      <button hlmBtn size="sm" type="submit" [disabled]="!newItem.trim()">Add</button>
                    </form>
                  </div>
                }
              </div>
            }
          </section>
        }

        <!-- Accounts (global) -->
        <section hlmCard class="gap-0 py-0">
          <div class="px-4 pt-4 pb-2">
            <p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Accounts</p>
            <p class="text-xs text-muted-foreground">Used for the monthly count. Shared by all years.</p>
          </div>
          @for (a of store.accounts(); track a.id) {
            <div class="flex items-center gap-2 border-t px-4 py-2 text-sm">
              <span class="flex-1" [class.text-muted-foreground]="a.archived">{{ a.name }} @if (a.archived) { <span hlmBadge variant="outline">archived</span> }</span>
              <button hlmBtn variant="ghost" size="icon-sm" aria-label="Move up" (click)="runP(api.moveAccount(a.id, 'up'))"><ng-icon name="lucideChevronUp" /></button>
              <button hlmBtn variant="ghost" size="icon-sm" aria-label="Move down" (click)="runP(api.moveAccount(a.id, 'down'))"><ng-icon name="lucideChevronDown" /></button>
              <button hlmBtn variant="ghost" size="icon-sm" aria-label="Rename" (click)="renameAccount(a.id, a.name)"><ng-icon name="lucidePencil" /></button>
              <button hlmBtn variant="ghost" size="icon-sm" [attr.aria-label]="a.archived ? 'Restore' : 'Archive'"
                      (click)="runP(api.updateAccount(a.id, { archived: !a.archived }))">
                <ng-icon [name]="a.archived ? 'lucideArchiveRestore' : 'lucideArchive'" />
              </button>
            </div>
          }
          <form class="flex gap-2 border-t px-4 py-3" (ngSubmit)="addAccount()">
            <input hlmInput name="account" class="flex-1" placeholder="New account (e.g. Revolut)" [(ngModel)]="newAccount" />
            <button hlmBtn type="submit" [disabled]="!newAccount.trim()"><ng-icon name="lucidePlus" /> Add</button>
          </form>
        </section>
      </div>
    } @else {
      <p class="text-muted-foreground">Create a year first.</p>
    }
  `,
})
export class Categories {
  protected readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);
  protected readonly monthShort = MONTH_SHORT;

  protected readonly editing = signal<string | null>(null);
  protected readonly openItems = signal<string | null>(null);
  protected editName = '';
  protected editGroup = '';
  protected newName = '';
  protected newKind: Kind = 'expense';
  protected newGroup = '';
  protected newItem = '';
  protected newAccount = '';
  protected readonly opening = signal(0);

  constructor() {
    // Keep the carry-over field in sync with the loaded year (data can arrive after the page opens).
    effect(() => this.opening.set(this.store.data()?.year.opening ?? 0));
  }

  /** All categories of the year (including archived ones), in display sections. */
  protected readonly sections = computed(() => {
    const cats = [...(this.store.data()?.year.categories ?? [])].sort((a, b) => a.order - b.order);
    return [
      { label: 'Income', categories: cats.filter((c) => c.kind === 'income') },
      ...groupExpenses(cats).map((g) => ({ label: g.group, categories: g.categories })),
      { label: 'Stocks', categories: cats.filter((c) => c.kind === 'stocks') },
    ].filter((s) => s.categories.length);
  });

  protected get y() {
    return this.store.y;
  }

  protected itemsOf(categoryId: string) {
    return this.store.items().filter((i) => i.categoryId === categoryId);
  }
  protected itemCount(categoryId: string) {
    return this.itemsOf(categoryId).length;
  }
  protected toggleItems(id: string) {
    this.openItems.set(this.openItems() === id ? null : id);
    this.newItem = '';
  }

  /** Run a year-changing API call and apply the result. */
  protected async run(p: Promise<YearResponse>) {
    try {
      this.store.applyYear(await p);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  protected async runP(p: Promise<ProfileResponse>) {
    try {
      this.store.applyProfile(await p);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  protected async saveOpening() {
    await this.run(this.api.setOpening(this.y, Number(this.opening()) || 0));
    toast.success('Saved');
  }

  protected async addCategory() {
    await this.run(this.api.addCategory(this.y, { name: this.newName.trim(), kind: this.newKind, group: this.newKind === 'expense' ? this.newGroup.trim() || undefined : undefined }));
    this.newName = '';
  }

  protected startEdit(c: Category) {
    this.editing.set(c.id);
    this.editName = c.name;
    this.editGroup = c.group;
  }

  protected async saveEdit(c: Category) {
    const patch: { name?: string; group?: string } = {};
    if (this.editName.trim() && this.editName.trim() !== c.name) patch.name = this.editName.trim();
    if (c.kind === 'expense' && this.editGroup.trim() && this.editGroup.trim() !== c.group) patch.group = this.editGroup.trim();
    if (Object.keys(patch).length) await this.run(this.api.updateCategory(this.y, c.id, patch));
    this.editing.set(null);
  }

  protected async remove(c: Category) {
    try {
      const res = await this.api.deleteCategory(this.y, c.id);
      this.store.applyYear(res);
      toast.success(res.archived ? `"${c.name}" archived (it has amounts)` : `"${c.name}" deleted`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  protected async addItem(categoryId: string) {
    await this.run(this.api.addItem(this.y, { categoryId, name: this.newItem.trim() }));
    this.newItem = '';
  }

  protected async renameItem(id: string, current: string) {
    const name = prompt('Item name', current)?.trim();
    if (name && name !== current) await this.run(this.api.updateItem(this.y, id, { name }));
  }

  protected async addAccount() {
    await this.runP(this.api.addAccount(this.newAccount.trim()));
    this.newAccount = '';
  }

  protected async renameAccount(id: string, current: string) {
    const name = prompt('Account name', current)?.trim();
    if (name && name !== current) await this.runP(this.api.updateAccount(id, { name }));
  }
}
