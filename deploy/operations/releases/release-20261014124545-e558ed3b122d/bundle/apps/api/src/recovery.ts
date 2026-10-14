import { z } from 'zod';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { Database } from './db.js';
import { IDENTITY_LOCK, serializeIdentity } from './identity.js';
import { recordIdentityEvent } from './identity-audit.js';

export const recoveryInputSchema = z.object({
  adminEmail: z.string().email().max(254).transform((val) => val.toLowerCase()),
  adminPassword: z.string().min(1).max(128),
  targetEmail: z.string().email().max(254).transform((val) => val.toLowerCase()),
  newPassword: z.string().min(1).max(128),
}).strict();

export type RecoveryInput = z.infer<typeof recoveryInputSchema>;

export interface RecoveryReceipt {
  action: 'password_recovery';
  actorId: string;
  targetId: string;
  at: string;
  revokedCount: number;
}

export function validateRecoveryInput(raw: unknown): RecoveryInput {
  const result = recoveryInputSchema.safeParse(raw);
  if (!result.success) {
    throw new Error('Dados de recuperação inválidos. A nova senha deve ter entre 1 e 128 caracteres.');
  }
  return result.data;
}

export async function recoverUserAccess(database: Database, rawInput: unknown): Promise<RecoveryReceipt> {
  const input = validateRecoveryInput(rawInput);
  const newHash = await hashPassword(input.newPassword);

  return serializeIdentity(database, async () => {
    const client = await database.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);

      // 1. Revalidar e bloquear o administrador autorizador
      const actorResult = await client.query<{ id: string; active: boolean }>(
        `SELECT u.id, u.active
         FROM auth_user u
         WHERE u.email = $1
         FOR UPDATE OF u`,
        [input.adminEmail]
      );
      const actor = actorResult.rows[0];
      if (!actor || !actor.active) {
        throw new Error('Administrador autorizador não encontrado ou inativo.');
      }

      // Exigir papel administrator E permissão roles.manage
      const actorPrivilegeResult = await client.query(
        `SELECT 1
         FROM user_role ur
         JOIN role_permission rp ON rp.role_id = ur.role_id
         WHERE ur.user_id = $1
           AND ur.role_id = 'administrator'
           AND rp.permission_id = 'roles.manage'`,
        [actor.id]
      );
      if ((actorPrivilegeResult.rowCount ?? 0) === 0) {
        throw new Error('Administrador autorizador não possui papel administrator e permissão roles.manage.');
      }

      // Reautenticação do administrador autorizador com senha atual oculta
      const actorAccountResult = await client.query<{ id: string; password: string | null }>(
        `SELECT a.id, a.password
         FROM auth_account a
         WHERE a.user_id = $1 AND a.provider_id = 'credential'
         FOR UPDATE OF a`,
        [actor.id]
      );
      if ((actorAccountResult.rowCount ?? 0) !== 1 || !actorAccountResult.rows[0]?.password) {
        throw new Error('Credencial do administrador autorizador inválida ou ambígua.');
      }

      const isActorPasswordValid = await verifyPassword({
        hash: actorAccountResult.rows[0].password,
        password: input.adminPassword,
      });
      if (!isActorPasswordValid) {
        throw new Error('Falha na autenticação do administrador autorizador: senha incorreta.');
      }

      // 2. Revalidar e bloquear a conta alvo
      let targetId: string;
      let targetAccountId: string;

      if (input.adminEmail === input.targetEmail) {
        targetId = actor.id;
        targetAccountId = actorAccountResult.rows[0].id;
      } else {
        const targetResult = await client.query<{ id: string; active: boolean }>(
          `SELECT u.id, u.active
           FROM auth_user u
           WHERE u.email = $1
           FOR UPDATE OF u`,
          [input.targetEmail]
        );
        const target = targetResult.rows[0];
        if (!target) {
          throw new Error('Conta alvo não encontrada.');
        }
        if (!target.active) {
          throw new Error('Conta alvo inativa. Recuperação não reativa contas.');
        }
        targetId = target.id;

        const targetAccountResult = await client.query<{ id: string }>(
          `SELECT a.id
           FROM auth_account a
           WHERE a.user_id = $1 AND a.provider_id = 'credential'
           FOR UPDATE OF a`,
          [target.id]
        );
        if ((targetAccountResult.rowCount ?? 0) === 0) {
          throw new Error('Conta alvo não possui credencial local associada.');
        }
        if ((targetAccountResult.rowCount ?? 0) > 1) {
          throw new Error('Ambiguidade detectada: múltiplas credenciais locais para a conta alvo.');
        }
        targetAccountId = targetAccountResult.rows[0]!.id;
      }

      // 3. Atualizar o hash da credencial alvo
      await client.query(
        `UPDATE auth_account
         SET password = $1, updated_at = now()
         WHERE id = $2`,
        [newHash, targetAccountId]
      );

      // 4. Revogar atomicamente todas as sessões da conta alvo
      const sessionResult = await client.query(
        `DELETE FROM auth_session
         WHERE user_id = $1`,
        [targetId]
      );
      const revokedCount = sessionResult.rowCount ?? 0;

      await recordIdentityEvent(client, { action: 'password_recovered', actorId: actor.id, targetUserId: targetId, revokedCount }, [targetId]);

      await client.query('COMMIT');
      inTransaction = false;

      const receipt: RecoveryReceipt = {
        action: 'password_recovery',
        actorId: actor.id,
        targetId,
        at: new Date().toISOString(),
        revokedCount,
      };

      return receipt;
    } catch (error) {
      if (inTransaction) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignora falha de rollback em caso de conexão já encerrada
        }
      }
      throw error;
    } finally {
      client.release();
    }
  });
}

export const recoverAccount = recoverUserAccess;
