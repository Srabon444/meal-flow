export type Role = 'employee' | 'admin';

export function resolveGuard(currentRole: Role | null, requiredRole: Role): string | null {
  if (!currentRole) return '/login';
  if (currentRole !== requiredRole) return '/login';
  return null;
}
