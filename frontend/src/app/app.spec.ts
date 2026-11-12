import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { App } from './app';
import { AuthService } from './core/auth.service';
import { FinanceStore } from './core/finance.store';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: FinanceStore, useValue: { init: () => {}, reset: () => {}, years: () => [], error: () => null, selectedYear: () => null } },
        { provide: SwUpdate, useValue: { isEnabled: false } },
      ],
    }).compileComponents();
  });

  it('shows the sign-in prompt when signed out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Personal Finances');
    expect(el.textContent).toContain('Sign in with Google');
  });
});
