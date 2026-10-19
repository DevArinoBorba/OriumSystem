/**
 * Comandos do Orium Agent (Hermes/WhatsApp) com as MESMAS regras da API HTTP:
 * permissão da rota + schema do contrato + função de domínio, sempre em nome do usuário real (actor).
 *
 * Princípios:
 * - Escritas aceitam somente IDs exatos (UUID). Nomes são resolvidos antes com os comandos find-*,
 *   que devolvem candidatos; havendo mais de um, o agente deve perguntar em vez de escolher.
 * - Nenhum valor padrão silencioso para responsável ou prazo.
 * - Notificações, auditoria e desbloqueio de dependências vêm das funções de domínio.
 */
import { z, ZodError } from 'zod';
import {
  approveTaskPauseSchema,
  createClientSchema,
  createDemandSchema,
  createMaterialSchema,
  createTaskCommentSchema,
  createTaskSchema,
  instantiateDemandTemplateInputSchema,
  listClientsQuerySchema,
  listDemandsQuerySchema,
  requestTaskPauseSchema,
  reviewTaskSchema,
  submitTaskReviewSchema,
  type SessionResponse,
} from '@orium/contracts';
import type { Database } from './db.js';
import { AppError } from './errors.js';
import { publicIdentity, requirePermission } from './identity.js';
import { createClient, listClients, resolveClientReadScope } from './clients.js';
import {
  acceptTask,
  approveTaskPause,
  createDemand,
  createTask,
  createTaskComment,
  getDemandById,
  getTaskById,
  listDemands,
  requestTaskPause,
  resumeTask,
  reviewTask,
  startTask,
  submitTaskReview,
} from './demands.js';
import { createMaterial } from './materials.js';
import { instantiateDemandTemplate, listDemandTemplates } from './templates.js';

export const AGENT_TIME_ZONE = 'America/Cuiaba';

export type AgentResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: string; message: string; needsClarification?: boolean; candidates?: unknown[] };

const uuid = z.string().uuid();

/** "hoje"/"amanha" viram datas do fuso da agência; demais valores seguem para o schema do contrato. */
export function agencyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function normalizeAgentDate(value: unknown, now: Date = new Date()): unknown {
  if (typeof value !== 'string') return value;
  const key = value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (key === 'hoje') return agencyToday(now);
  if (key === 'amanha') return agencyToday(new Date(now.getTime() + 86_400_000));
  return value.trim();
}

/**
 * Minutos até um horário "HH:MM" de hoje no fuso da agência, para lembretes relativos ("in 95m"),
 * que não dependem do fuso do servidor. null quando o formato é inválido.
 */
export function minutesUntilAgencyTime(at: string, now: Date = new Date()): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!match) return null;
  const target = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: AGENT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return target - (hour * 60 + minute);
}

function withDates<T extends Record<string, unknown>>(input: T, keys: string[]): T {
  const copy: Record<string, unknown> = { ...input };
  for (const key of keys) {
    if (key in copy) copy[key] = normalizeAgentDate(copy[key]);
  }
  return copy as T;
}

const agentMessages: Record<string, string> = {
  ACTOR_REQUIRED: 'Informe "actor" com o e-mail do usuário do sistema que fez o pedido.',
  ACTOR_NOT_FOUND: 'Nenhum usuário ativo com este e-mail. Confirme quem fez o pedido antes de agir.',
  UNAUTHENTICATED: 'O usuário informado está inativo no sistema.',
  FORBIDDEN:
    'Sem permissão para esta ação. Ações da tarefa (aceitar, iniciar, enviar para revisão, pedir pausa) só podem ser feitas pelo responsável; criar/aprovar/retomar só por administradores.',
  NOT_FOUND: 'Registro não encontrado ou não visível para este usuário.',
  VERSION_CONFLICT: 'O registro foi alterado ao mesmo tempo por outra pessoa. Consulte novamente e repita.',
  TASK_ALREADY_ACCEPTED: 'Esta tarefa já foi aceita.',
  TASK_ALREADY_STARTED_OR_COMPLETED: 'Esta tarefa já foi iniciada ou concluída.',
  TASK_NOT_ACCEPTED: 'A tarefa precisa ser aceita pelo responsável antes de iniciar.',
  TASK_NOT_READY_OR_CHANGES_REQUESTED: 'Só é possível iniciar tarefas prontas ou com ajustes solicitados.',
  MANDATORY_REQUIREMENTS_UNSATISFIED: 'Há requisitos obrigatórios pendentes; a tarefa não pode iniciar.',
  DEPENDENCIES_UNCOMPLETED: 'Há tarefas das quais esta depende ainda não concluídas.',
  TASK_NOT_READY: 'A tarefa ainda não está pronta para iniciar.',
  TASK_NOT_IN_PRODUCTION: 'A tarefa precisa estar em produção para esta ação.',
  TASK_NOT_IN_REVIEW: 'A tarefa precisa estar em revisão para esta ação.',
  NO_PENDING_PAUSE_REQUEST: 'Não há pedido de pausa pendente nesta tarefa.',
  TASK_NOT_PAUSED: 'A tarefa não está pausada.',
  DEMAND_NOT_OPEN: 'A demanda já foi concluída; não aceita novas tarefas.',
  TASK_DEPENDENCY_CYCLE: 'As dependências informadas criariam um ciclo.',
  VALIDATION_FAILED: 'Dados inválidos ou incompletos.',
  UNKNOWN_COMMAND: 'Comando desconhecido.',
};

function fail(code: string, extra: Partial<Extract<AgentResult, { ok: false }>> = {}): AgentResult {
  return { ok: false, code, message: agentMessages[code] ?? code, ...extra };
}

async function resolveActor(database: Database, input: Record<string, unknown>): Promise<SessionResponse> {
  const email = typeof input.actor === 'string' ? input.actor.trim().toLowerCase() : '';
  if (!email) throw new AppError(400, 'ACTOR_REQUIRED');
  const rows = await database.pool.query<{ id: string }>(
    'SELECT id FROM auth_user WHERE lower(email) = $1 AND active = true',
    [email],
  );
  const id = rows.rows[0]?.id;
  if (!id || rows.rows.length !== 1) throw new AppError(404, 'ACTOR_NOT_FOUND');
  return publicIdentity(database, id);
}

async function taskVersion(database: Database, identity: SessionResponse, taskId: string): Promise<number> {
  requirePermission(identity, 'tasks.read');
  const detail = await getTaskById(database, identity, uuid.parse(taskId));
  return detail.task.version;
}

/** Resultado de busca: 0 = não encontrado, 1 = pode prosseguir, 2+ = perguntar ao usuário. */
function candidatesResult(kind: string, items: Record<string, unknown>[]): AgentResult {
  if (items.length === 0) {
    return { ok: false, code: 'NOT_FOUND', message: `Nenhum(a) ${kind} encontrado(a). Pergunte ao usuário.`, needsClarification: true, candidates: [] };
  }
  if (items.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS',
      message: `Encontrei ${items.length} ${kind}s possíveis. Pergunte ao usuário qual é o correto antes de agir.`,
      needsClarification: true,
      candidates: items,
    };
  }
  return { ok: true, match: items[0] };
}

type Handler = (database: Database, identity: SessionResponse, input: Record<string, unknown>) => Promise<AgentResult>;

const handlers: Record<string, Handler> = {
  async whoami(_database, identity) {
    return { ok: true, user: identity.user, roles: identity.roles, permissions: identity.permissions };
  },

  async today(_database, _identity, input) {
    const base = { today: agencyToday(), timeZone: AGENT_TIME_ZONE, now: new Date().toISOString() };
    if (typeof input.at !== 'string') return { ok: true, ...base };
    const minutes = minutesUntilAgencyTime(input.at);
    if (minutes === null) return fail('VALIDATION_FAILED', { needsClarification: true, message: 'Use "at" no formato HH:MM (horário de Cuiabá).' });
    if (minutes <= 0) {
      return fail('TIME_ALREADY_PASSED', { needsClarification: true, message: `${input.at} de hoje já passou em Cuiabá. Pergunte ao usuário um novo horário.` });
    }
    return { ok: true, ...base, at: input.at, minutesUntil: minutes, schedule: `in ${minutes}m` };
  },

  async 'find-client'(database, identity, input) {
    resolveClientReadScope(identity);
    const q = z.string().trim().min(1).max(100).parse(input.query);
    const result = await listClients(database, listClientsQuerySchema.parse({ q, status: 'active', pageSize: 10 }), identity);
    const items = result.clients.map((c) => ({ id: c.id, name: c.name, contactName: c.contactName ?? null }));
    const exact = items.filter((c) => c.name.toLowerCase() === q.toLowerCase());
    return candidatesResult('cliente', exact.length === 1 ? exact : items);
  },

  async 'find-demand'(database, identity, input) {
    requirePermission(identity, 'demands.read');
    const query = listDemandsQuerySchema.parse({
      q: typeof input.query === 'string' && input.query.trim() ? input.query.trim() : undefined,
      clientId: input.clientId,
      status: 'open',
      pageSize: 20,
    });
    const result = await listDemands(database, identity, query);
    const items = result.demands.map((d) => ({
      id: d.id,
      title: d.title,
      client: d.client.name,
      priority: d.priority,
      deliveryDate: d.deliveryDate,
    }));
    if (input.list === true) return { ok: true, demands: items };
    return candidatesResult('demanda', items);
  },

  async 'find-task'(database, identity, input) {
    requirePermission(identity, 'tasks.read');
    const q = z.string().trim().min(1).max(160).parse(input.query);
    const demandId = input.demandId === undefined ? null : uuid.parse(input.demandId);
    const rows = await database.pool.query<{ id: string }>(
      `SELECT t.id FROM task t
        WHERE t.status <> 'completed' AND t.title ILIKE $1 ESCAPE '\\' AND ($2::uuid IS NULL OR t.demand_id = $2::uuid)
        ORDER BY t.updated_at DESC LIMIT 15`,
      [`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, demandId],
    );
    const items: Record<string, unknown>[] = [];
    for (const row of rows.rows) {
      try {
        const detail = await getTaskById(database, identity, row.id);
        items.push({
          id: detail.task.id,
          title: detail.task.title,
          status: detail.task.status,
          demandId: detail.task.demandId,
          assignedToUserId: detail.task.assignedToUserId,
          deliveryDate: detail.task.deliveryDate,
        });
      } catch (error) {
        if (!(error instanceof AppError) || (error.status !== 403 && error.status !== 404)) throw error;
      }
    }
    return candidatesResult('tarefa', items);
  },

  async 'find-user'(database, identity, input) {
    requirePermission(identity, 'users.read');
    const q = z.string().trim().min(1).max(160).parse(input.query).toLowerCase();
    const rows = await database.pool.query<{ id: string; name: string; email: string; role: string | null }>(
      `SELECT u.id, u.name, u.email, ur.role_id AS role FROM auth_user u
        LEFT JOIN user_role ur ON ur.user_id = u.id
        WHERE u.active = true AND (lower(u.name) LIKE $1 OR lower(u.email) LIKE $1)
        ORDER BY u.name LIMIT 10`,
      [`%${q}%`],
    );
    const exact = rows.rows.filter((u) => u.name.toLowerCase() === q || u.email.toLowerCase() === q);
    return candidatesResult('usuário', exact.length === 1 ? exact : rows.rows);
  },

  async 'get-demand'(database, identity, input) {
    requirePermission(identity, 'demands.read');
    return { ok: true, ...(await getDemandById(database, identity, uuid.parse(input.demandId))) };
  },

  async 'get-task'(database, identity, input) {
    requirePermission(identity, 'tasks.read');
    return { ok: true, ...(await getTaskById(database, identity, uuid.parse(input.taskId))) };
  },

  async 'list-templates'(database, identity) {
    requirePermission(identity, 'demands.read');
    const result = await listDemandTemplates(database, identity);
    return { ok: true, templates: result.templates.map((t) => ({ id: t.id, title: t.title, category: t.category, active: t.active })) };
  },

  async 'create-client'(database, identity, input) {
    requirePermission(identity, 'clients.write');
    requirePermission(identity, 'clients.manage');
    const data = createClientSchema.parse(pick(input, ['name', 'contactName', 'email', 'phone', 'notes', 'segment', 'briefingSummary', 'driveFolderUrl']));
    const existing = await listClients(database, listClientsQuerySchema.parse({ q: data.name, status: 'all', pageSize: 10 }), identity);
    const same = existing.clients.filter((c) => c.name.trim().toLowerCase() === data.name.toLowerCase());
    if (same.length > 0) {
      return fail('CLIENT_ALREADY_EXISTS', {
        needsClarification: true,
        message: 'Já existe cliente com este nome (pode estar arquivado). Confirme com o usuário antes de criar outro.',
        candidates: same.map((c) => ({ id: c.id, name: c.name, archived: Boolean(c.archivedAt) })),
      });
    }
    return { ok: true, client: await createClient(database, identity, data) };
  },

  async 'create-demand'(database, identity, input) {
    requirePermission(identity, 'demands.write');
    const data = createDemandSchema.parse(withDates(pick(input, ['clientId', 'title', 'description', 'priority', 'deliveryDate']), ['deliveryDate']));
    return { ok: true, ...(await createDemand(database, identity, data)) };
  },

  async 'create-task'(database, identity, input) {
    requirePermission(identity, 'tasks.manage');
    const fields = pick(input, ['demandId', 'assignedToUserId', 'title', 'description', 'priority', 'deliveryDate', 'requirements', 'dependsOnTaskIds']);
    if (fields.deliveryDate === undefined) throw new AppError(400, 'DELIVERY_DATE_REQUIRED');
    const data = createTaskSchema.parse(withDates(fields, ['deliveryDate']));
    uuid.parse(data.assignedToUserId);
    return { ok: true, ...(await createTask(database, identity, data)) };
  },

  async 'instantiate-template'(database, identity, input) {
    requirePermission(identity, 'demands.write');
    const templateId = uuid.parse(input.templateId);
    const data = instantiateDemandTemplateInputSchema.parse(
      withDates(pick(input, ['clientId', 'title', 'description', 'priority', 'startDate', 'deliveryDate', 'assignments']), ['startDate', 'deliveryDate']),
    );
    return { ok: true, ...(await instantiateDemandTemplate(database, identity, templateId, data)) };
  },

  async 'accept-task'(database, identity, input) {
    requirePermission(identity, 'tasks.execute');
    const taskId = uuid.parse(input.taskId);
    return { ok: true, ...(await acceptTask(database, identity, taskId, { version: await taskVersion(database, identity, taskId) })) };
  },

  async 'start-task'(database, identity, input) {
    requirePermission(identity, 'tasks.execute');
    const taskId = uuid.parse(input.taskId);
    return { ok: true, ...(await startTask(database, identity, taskId, { version: await taskVersion(database, identity, taskId) })) };
  },

  async 'submit-review'(database, identity, input) {
    requirePermission(identity, 'tasks.execute');
    const taskId = uuid.parse(input.taskId);
    const data = submitTaskReviewSchema.parse({
      version: await taskVersion(database, identity, taskId),
      deliveryNotes: input.deliveryNotes,
      previewUrl: input.previewUrl ?? null,
    });
    return { ok: true, ...(await submitTaskReview(database, identity, taskId, data)) };
  },

  async 'review-task'(database, identity, input) {
    requirePermission(identity, 'tasks.review');
    const taskId = uuid.parse(input.taskId);
    const data = reviewTaskSchema.parse({
      version: await taskVersion(database, identity, taskId),
      decision: input.decision,
      feedback: input.feedback,
    });
    return { ok: true, ...(await reviewTask(database, identity, taskId, data)) };
  },

  async 'request-pause'(database, identity, input) {
    requirePermission(identity, 'tasks.execute');
    const taskId = uuid.parse(input.taskId);
    const data = requestTaskPauseSchema.parse({ version: await taskVersion(database, identity, taskId), reason: input.reason });
    return { ok: true, ...(await requestTaskPause(database, identity, taskId, data)) };
  },

  async 'approve-pause'(database, identity, input) {
    requirePermission(identity, 'tasks.manage');
    const taskId = uuid.parse(input.taskId);
    const data = approveTaskPauseSchema.parse(
      withDates({ version: await taskVersion(database, identity, taskId), reason: input.reason, deliveryDate: input.deliveryDate }, ['deliveryDate']),
    );
    return { ok: true, ...(await approveTaskPause(database, identity, taskId, data)) };
  },

  async 'resume-task'(database, identity, input) {
    requirePermission(identity, 'tasks.manage');
    const taskId = uuid.parse(input.taskId);
    return { ok: true, ...(await resumeTask(database, identity, taskId, { version: await taskVersion(database, identity, taskId) })) };
  },

  async 'comment-task'(database, identity, input) {
    if (!identity.permissions.includes('tasks.execute') && !identity.permissions.includes('tasks.manage')) {
      throw new AppError(403, 'FORBIDDEN');
    }
    const taskId = uuid.parse(input.taskId);
    const data = createTaskCommentSchema.parse({ content: input.content });
    return { ok: true, ...(await createTaskComment(database, identity, taskId, data)) };
  },

  async 'add-material'(database, identity, input) {
    requirePermission(identity, 'materials.write');
    const data = createMaterialSchema.parse(pick(input, ['clientId', 'demandId', 'taskId', 'title', 'description', 'category', 'url']));
    return { ok: true, ...(await createMaterial(database, identity, data)) };
  },
};

function pick(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

export const agentCommands = Object.keys(handlers);

export async function runAgentCommand(database: Database, command: string, input: Record<string, unknown>): Promise<AgentResult> {
  const handler = handlers[command];
  if (!handler) return { ...fail('UNKNOWN_COMMAND'), candidates: agentCommands } as AgentResult;
  try {
    const identity = command === 'today' ? ({} as SessionResponse) : await resolveActor(database, input);
    return await handler(database, identity, input);
  } catch (error) {
    if (error instanceof ZodError) {
      return fail('VALIDATION_FAILED', {
        needsClarification: true,
        message: `${agentMessages.VALIDATION_FAILED} Campos: ${error.issues.map((i) => `${i.path.join('.') || 'entrada'} (${i.message})`).join('; ')}`,
      });
    }
    if (error instanceof AppError) {
      if (error.code === 'DELIVERY_DATE_REQUIRED') {
        return fail(error.code, { needsClarification: true, message: 'Informe o prazo (deliveryDate). Se o usuário não disse, pergunte.' });
      }
      return fail(error.code);
    }
    return fail('INTERNAL_ERROR', { message: 'Falha interna ao executar o comando. Nada foi confirmado; avise o administrador.' });
  }
}
