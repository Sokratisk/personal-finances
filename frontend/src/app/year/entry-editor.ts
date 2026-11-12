import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { ApiService } from '../core/api.service';
import { FinanceStore, errorMessage } from '../core/finance.store';
import { MONTH_NAMES } from '../core/format';
import type { Entry } from '../core/models';

/**
 * Add or edit one amount. With `categoryId` set the category is fixed (used inside a cell);
 * otherwise the user picks it. Amounts can be negative (refunds, split bills).
 */
@Component({
  selector: 'app-entry-editor',
  imports: [FormsModule, HlmButtonImports, HlmFieldImports, HlmInputImports, HlmLabelImports, HlmNativeSelectImports],
  template: `
    <form #f="ngForm" (ngSubmit)="save()" class="grid gap-3">
      <div class="grid grid-cols-2 gap-3">
        <div hlmField>
          <label hlmLabel for="ee-amount">Amount (€)</label>
          <input hlmInput id="ee-amount" name="amount" type="number" inputmode="decimal" step="0.01" required
                 [(ngModel)]="amount" placeholder="0.00" autocomplete="off" />
        </div>
        <div hlmField>
          <label hlmLabel for="ee-month">Month</label>
          <hlm-native-select selectId="ee-month" name="month" [(ngModel)]="month">
            @for (name of monthNames; track $index) {
              <option hlmNativeSelectOption [ngValue]="$index + 1">{{ name }}</option>
            }
          </hlm-native-select>
        </div>
      </div>

      @if (!categoryId()) {
        <div hlmField>
          <label hlmLabel for="ee-cat">Category</label>
          <hlm-native-select selectId="ee-cat" name="category" required [(ngModel)]="pickedCategory">
            <option hlmNativeSelectOption value="" disabled>Choose…</option>
            @for (k of kinds; track k.kind) {
              <optgroup hlmNativeSelectOptGroup [label]="k.label">
                @for (c of categoriesOf(k.kind); track c.id) {
                  <option hlmNativeSelectOption [value]="c.id">{{ c.name }}</option>
                }
              </optgroup>
            }
          </hlm-native-select>
        </div>
      }

      @if (itemsForCategory().length) {
        <div hlmField>
          <label hlmLabel for="ee-item">Item</label>
          <hlm-native-select selectId="ee-item" name="item" [(ngModel)]="itemId">
            <option hlmNativeSelectOption value="">— none —</option>
            @for (i of itemsForCategory(); track i.id) {
              <option hlmNativeSelectOption [value]="i.id">{{ i.name }}</option>
            }
          </hlm-native-select>
        </div>
      }

      <div hlmField>
        <label hlmLabel for="ee-note">Note <span class="text-muted-foreground">(optional)</span></label>
        <input hlmInput id="ee-note" name="note" [(ngModel)]="note" maxlength="200" placeholder="e.g. Supermarket" autocomplete="off" />
      </div>

      <div class="flex gap-2">
        <button hlmBtn type="submit" class="flex-1" [disabled]="f.invalid || saving()">
          {{ saving() ? 'Saving…' : entry() ? 'Save' : 'Add' }}
        </button>
        @if (entry()) {
          <button hlmBtn type="button" variant="outline" (click)="cancelled.emit()">Cancel</button>
        }
      </div>
    </form>
  `,
})
export class EntryEditor {
  private readonly api = inject(ApiService);
  protected readonly store = inject(FinanceStore);

  /** Fixed category (cell mode). */
  readonly categoryId = input<string | null>(null);
  readonly initialMonth = input.required<number>();
  /** Entry being edited (null = add). */
  readonly entry = input<Entry | null>(null);
  /** Preselect an item, e.g. when adding from a trip. */
  readonly initialItemId = input<string | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  protected readonly monthNames = MONTH_NAMES;
  protected readonly kinds = [
    { kind: 'expense', label: 'Expenses' },
    { kind: 'income', label: 'Income' },
    { kind: 'stocks', label: 'Stocks' },
  ] as const;
  protected readonly saving = signal(false);

  protected amount: number | null = null;
  protected month = 1;
  protected note = '';
  protected itemId = '';
  protected readonly pickedCategory = signal('');

  private readonly category = computed(() => this.categoryId() ?? this.pickedCategory());
  protected readonly itemsForCategory = computed(() => this.store.items().filter((i) => i.categoryId === this.category()));

  constructor() {
    // (Re)fill the form when the edited entry or month changes.
    effect(() => {
      const e = this.entry();
      this.month = this.initialMonth();
      this.amount = e?.amount ?? null;
      this.note = e?.note ?? '';
      this.itemId = e?.itemId ?? this.initialItemId() ?? '';
    });

    // Adding to a category that has an item in this month (an ongoing trip)? Preselect the newest one.
    effect(() => {
      const items = this.itemsForCategory();
      if (this.entry() || this.initialItemId()) return;
      const month = untracked(() => this.month);
      this.itemId = [...items].reverse().find((i) => i.month === month)?.id ?? '';
    });
  }

  protected categoriesOf(kind: string) {
    return this.store.activeCategories().filter((c) => c.kind === kind);
  }

  protected async save() {
    const categoryId = this.category();
    if (!categoryId || this.amount === null || !Number(this.amount)) return;
    this.saving.set(true);
    try {
      const y = this.store.y;
      const e = this.entry();
      const body = { categoryId, amount: Number(this.amount), note: this.note.trim() || undefined };
      if (e) {
        const res = await this.api.updateEntry(y, this.initialMonth(), e.id, {
          ...body,
          note: this.note.trim(),
          itemId: this.itemId || null,
          month: this.month,
        });
        this.store.applyMonths(res);
      } else {
        this.store.applyMonths(await this.api.addEntry(y, this.month, { ...body, itemId: this.itemId || undefined }));
        this.amount = null;
        this.note = '';
      }
      this.saved.emit();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
