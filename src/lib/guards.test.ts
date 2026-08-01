import { describe, it, expect } from 'vitest';
import { resolveGuard } from './guards';

describe('resolveGuard', () => {
  it('redirects to login when not authenticated', () => {
    expect(resolveGuard(null, 'admin')).toBe('/login');
  });

  it('redirects to login when role does not match', () => {
    expect(resolveGuard('employee', 'admin')).toBe('/login');
  });

  it('allows access when role matches', () => {
    expect(resolveGuard('admin', 'admin')).toBeNull();
  });
});
