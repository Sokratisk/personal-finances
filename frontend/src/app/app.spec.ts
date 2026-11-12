import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { AuthService } from './core/auth.service';
import { signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: AuthService, useValue: { user: signal(null) } },
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
