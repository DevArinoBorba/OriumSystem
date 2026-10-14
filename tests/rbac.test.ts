import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  clientContractStatusSchema,
  clientFunctionalRoleSchema,
  createClientSchema,
  createClientScopeItemSchema,
  permissionSchema,
  scopeCadenceSchema,
  updateClientSchema,
  updateClientScopeItemSchema,
  upsertClientTeamMemberSchema,
  type Permission,
  type SessionResponse,
} from '@orium/contracts';
import { requirePermission } from '../apps/api/src/identity.js';
import { resolveClientReadScope } from '../apps/api/src/clients.js';
import { AppError } from '../apps/api/src/errors.js';

const identity = (roles: SessionResponse['roles'], permissions: SessionResponse['permissions']): SessionResponse => ({
  user: { id: 'unit-user', name: 'Unit User', email: 'unit@example.test' }, roles, permissions,
});

describe('backend permission boundary', () => {
  it.each(permissionSchema.options)('allows administrator with explicit grant %s', (permission) => {
    expect(() => requirePermission(identity(['administrator'], [permission]), permission)).not.toThrow();
  });

  it.each(['protected.read', 'clients.read.assigned', 'demands.read', 'tasks.read', 'tasks.execute'] as const)(
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
    'clients.write', 'clients.manage', 'clients.team.manage', 'clients.archive',
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

  it.each(['clients.read', 'clients.read.assigned', 'clients.write', 'clients.manage', 'clients.team.manage', 'clients.archive'] as const)(
    'denies collaborator client permission %s when grant is absent', (permission) => {
      expect(() => requirePermission(identity(['collaborator'], ['protected.read']), permission)).toThrow(AppError);
    },
  );

  describe('Phase 2A Row-Level client read scope resolution', () => {
    it('resolves global scope when actor holds clients.read', () => {
      expect(resolveClientReadScope(identity(['administrator'], ['clients.read', 'clients.read.assigned']))).toBe('global');
    });

    it('resolves assigned scope when actor holds only clients.read.assigned', () => {
      expect(resolveClientReadScope(identity(['collaborator'], ['protected.read', 'clients.read.assigned']))).toBe('assigned');
    });

    it('throws 403 FORBIDDEN when actor holds neither clients.read nor clients.read.assigned', () => {
      expect(() => resolveClientReadScope(identity(['collaborator'], ['protected.read']))).toThrow(AppError);
    });
  });

  describe('Phase 2A @orium/contracts schema validation', () => {
    it('validates contract_status, functional_role, and scope_cadence enums', () => {
      for (const status of ['onboarding', 'active', 'paused', 'offboarding', 'archived'] as const) {
        expect(clientContractStatusSchema.parse(status)).toBe(status);
      }
      expect(() => clientContractStatusSchema.parse('invalid_status')).toThrow();

      for (const role of [
        'account_manager',
        'traffic_manager',
        'designer',
        'social_media',
        'copywriter',
        'developer',
        'video_maker',
      ] as const) {
        expect(clientFunctionalRoleSchema.parse(role)).toBe(role);
      }
      expect(() => clientFunctionalRoleSchema.parse('ceo')).toThrow();

      for (const cadence of ['one_off', 'weekly', 'monthly'] as const) {
        expect(scopeCadenceSchema.parse(cadence)).toBe(cadence);
      }
      expect(() => scopeCadenceSchema.parse('hourly')).toThrow();
    });

    it('validates createClientSchema and updateClientSchema with agency metadata and rejects invalid URLs', () => {
      const validCreate = createClientSchema.parse({
        name: 'Cliente Agência Fase 2A',
        contractStatus: 'onboarding',
        segment: 'E-commerce Moda',
        accountManagerUserId: randomUUID(),
        briefingSummary: 'Foco em performance Meta Ads e criativos semanais.',
        brandKitUrl: 'https://figma.com/file/brandkit-cliente',
        driveFolderUrl: 'https://drive.google.com/drive/folders/cliente',
        activeChannels: ['instagram', 'meta_ads', 'tiktok'],
      });
      expect(validCreate.contractStatus).toBe('onboarding');
      expect(validCreate.activeChannels).toEqual(['instagram', 'meta_ads', 'tiktok']);

      // Rejects non-HTTP/HTTPS URL or embedded credentials
      expect(() => createClientSchema.parse({
        name: 'Bad URL Client',
        brandKitUrl: 'javascript:alert(1)',
      })).toThrow();
      expect(() => createClientSchema.parse({
        name: 'Creds URL Client',
        driveFolderUrl: 'https://user:pass@drive.google.com/folder',
      })).toThrow();

      // updateClientSchema requires version and at least one editable field
      expect(() => updateClientSchema.parse({ version: 1 })).toThrow();
      const validUpdate = updateClientSchema.parse({
        version: 2,
        contractStatus: 'active',
        activeChannels: ['instagram', 'google_ads'],
      });
      expect(validUpdate.version).toBe(2);
      expect(validUpdate.contractStatus).toBe('active');
    });

    it('validates upsertClientTeamMemberSchema, createClientScopeItemSchema, and updateClientScopeItemSchema', () => {
      const teamInput = upsertClientTeamMemberSchema.parse({
        userId: randomUUID(),
        functionalRole: 'designer',
        isPrimary: true,
        canCreateDemands: false,
      });
      expect(teamInput.functionalRole).toBe('designer');
      expect(teamInput.isPrimary).toBe(true);

      const scopeInput = createClientScopeItemSchema.parse({
        title: 'Pacote de Reels Mensal',
        category: 'video',
        cadence: 'monthly',
        contractedQuantity: 8,
        slaBusinessDays: 3,
        slaHours: 72,
        isActive: true,
      });
      expect(scopeInput.cadence).toBe('monthly');
      expect(scopeInput.contractedQuantity).toBe(8);
      expect(scopeInput.slaHours).toBe(72);

      expect(() => createClientScopeItemSchema.parse({
        title: 'Quantidade Inválida',
        contractedQuantity: 0,
      })).toThrow();

      expect(() => updateClientScopeItemSchema.parse({ version: 1 })).toThrow();
      const scopePatch = updateClientScopeItemSchema.parse({
        version: 1,
        contractedQuantity: 12,
        isActive: false,
      });
      expect(scopePatch.contractedQuantity).toBe(12);
      expect(scopePatch.isActive).toBe(false);
    });
  });
});
