import { describe, expect, it } from 'vitest';
import { permissionSchema, type Permission, type SessionResponse } from '@orium/contracts';
import { requirePermission } from '../apps/api/src/identity.js';
import { AppError } from '../apps/api/src/errors.js';

const identity = (roles: SessionResponse['roles'], permissions: SessionResponse['permissions']): SessionResponse => ({
  user: { id: 'unit-user', name: 'Unit User', email: 'unit@example.test' }, roles, permissions,
});

describe('backend permission boundary', () => {
  it.each(permissionSchema.options)('allows administrator with explicit grant %s', (permission) => {
    expect(() => requirePermission(identity(['administrator'], [permission]), permission)).not.toThrow();
  });

  it.each(['protected.read', 'demands.read', 'tasks.read', 'tasks.execute'] as const)(
    'allows collaborator with explicit grant %s if present in schema', (permission) => {
      if ((permissionSchema.options as readonly string[]).includes(permission)) {
        expect(() => requirePermission(identity(['collaborator'], [permission as Permission]), permission as Permission)).not.toThrow();
      }
    }
  );

  it.each(permissionSchema.options)('denies missing explicit grant %s even to administrator', (permission) => {
    expect(() => requirePermission(identity(['administrator'], []), permission)).toThrow(AppError);
  });

  it.each([
    'users.read', 'users.create', 'users.deactivate', 'roles.manage',
    'demands.write', 'tasks.manage', 'tasks.review',
    'clients.write', 'clients.archive',
  ] as const)(
    'denies collaborator administrative permission %s even if a grant leaks into identity', (permission) => {
      try {
        requirePermission(identity(['collaborator'], [permission as Permission]), permission as Permission);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
        return;
      }
      throw new Error(`Administrative access was unexpectedly allowed for ${permission}.`);
    },
  );

  it.each(['clients.read', 'clients.write', 'clients.archive'] as const)(
    'denies collaborator client permission %s when grant is absent', (permission) => {
      expect(() => requirePermission(identity(['collaborator'], ['protected.read']), permission)).toThrow(AppError);
    },
  );
});
