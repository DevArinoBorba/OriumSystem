import {
  backupStatusResponseSchema,
  clientListResponseSchema,
  clientResponseSchema,
  clientTimelineResponseSchema,
  dashboardResponseSchema,
  demandDetailResponseSchema,
  demandHistoryResponseSchema,
  demandListResponseSchema,
  demandResponseSchema,
  demandTemplateListResponseSchema,
  demandTemplateResponseSchema,
  listMaterialTargetsResponseSchema,
  listMaterialsResponseSchema,
  materialHistoryResponseSchema,
  materialSchema,
  notificationListResponseSchema,
  notificationResponseSchema,
  productivityReportResponseSchema,
  bottlenecksReportResponseSchema,
  publicUserSchema,
  roleSchema,
  sessionResponseSchema,
  taskCommentsResponseSchema,
  taskDetailResponseSchema,
  taskResponseSchema,
  triggerBackupResponseSchema,
  clientCredentialSchema,
  clientCredentialListResponseSchema,
  clientCredentialSecretResponseSchema,
  hermesStatusResponseSchema,
  type AddDependencyInput,
  type ApproveTaskPauseInput,
  type BackupStatusResponse,
  type BottlenecksReportResponse,
  type TriggerBackupResponse,
  type Client,
  type ClientCredential,
  type ClientCredentialListResponse,
  type ClientCredentialSecretResponse,
  type CreateClientCredentialInput,
  type UpdateClientCredentialInput,
  type HermesStatusResponse,
  type ClientListResponse,
  type ClientTimelineQuery,
  type ClientTimelineResponse,
  type CompleteDemandInput,
  type CreateClientInput,
  type CreateDemandInput,
  type CreateDemandTemplateInput,
  type CreateMaterialInput,
  type CreateTaskCommentInput,
  type CreateTaskInput,
  type Demand,
  type DemandEvent,
  type DemandResponse,
  type DemandTemplateListResponse,
  type DemandTemplateResponse,
  type DashboardResponse,
  type InstantiateDemandTemplateInput,
  type ListMaterialTargetsQuery,
  type ListMaterialTargetsResponse,
  type ListMaterialsQuery,
  type ListMaterialsResponse,
  type ListNotificationsQuery,
  type NotificationListResponse,
  type NotificationResponse,
  type Material,
  type MaterialHistoryQuery,
  type MaterialHistoryResponse,
  type ProductivityReportResponse,
  type RemoveDependencyInput,
  type ReassignTaskInput,
  type RequestTaskPauseInput,
  type Requirement,
  type ReviewTaskInput,
  type SessionResponse,
  type SubmitTaskReviewInput,
  type Task,
  type TaskComment,
  type TaskVersionInput,
  type UpdateClientInput,
  type UpdateDemandInput,
  type UpdateDemandTemplateInput,
  type UpdateMaterialInput,
  type UpdateProfileInput,
  type UpdateRequirementInput,
  type ChangePasswordInput,
} from '@orium/contracts';
import type { UserListItem } from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message || code);
    this.name = 'ApiError';
  }
}

function parseUserListItem(raw: unknown): UserListItem {
  if (typeof raw !== 'object' || raw === null) {
    throw new ApiError(500, 'INVALID_RESPONSE', 'Item de usuário inválido.');
  }
  const item = raw as Record<string, unknown>;
  const base = publicUserSchema.parse({
    id: item.id,
    name: item.name,
    email: item.email,
  });
  const role = roleSchema.parse(item.role);
  if (typeof item.active !== 'boolean') {
    throw new ApiError(500, 'INVALID_RESPONSE', 'Campo active deve ser booleano.');
  }
  return {
    id: base.id,
    name: base.name,
    email: base.email,
    active: item.active,
    role,
  };
}

function parseUsersListResponse(raw: unknown): { users: UserListItem[] } {
  if (typeof raw !== 'object' || raw === null || !('users' in raw) || !Array.isArray(raw.users)) {
    throw new ApiError(500, 'INVALID_RESPONSE', 'Resposta da lista de usuários inválida.');
  }
  return {
    users: raw.users.map(parseUserListItem),
  };
}

function parseSuccessResponse(raw: unknown): { success: boolean } {
  if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).success !== true) {
    throw new ApiError(500, 'INVALID_RESPONSE', 'Resposta de sucesso inválida.');
  }
  return { success: true };
}

async function request<T>(
  url: string,
  options: RequestInit,
  onUnauthorized: () => void,
  parser: (data: unknown) => T,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (response.status === 401) {
    let errorCode = 'UNAUTHENTICATED';
    try {
      const errorJson = (await response.json()) as { error?: { code?: string } };
      if (errorJson?.error?.code) {
        errorCode = errorJson.error.code;
      }
    } catch {
      // Body is not JSON
    }
    if (errorCode === 'UNAUTHENTICATED') {
      onUnauthorized();
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sessão expirada ou não autenticada.');
    }
    throw new ApiError(401, errorCode);
  }

  if (!response.ok) {
    let errorCode = 'REQUEST_FAILED';
    try {
      const errorJson = (await response.json()) as { error?: { code?: string } };
      if (errorJson?.error?.code) {
        errorCode = errorJson.error.code;
      }
    } catch {
      // Body is not JSON
    }
    throw new ApiError(response.status, errorCode);
  }

  const rawJson: unknown = await response.json();
  try {
    return parser(rawJson);
  } catch (err) {
    throw new ApiError(
      500,
      'INVALID_RESPONSE',
      err instanceof Error ? err.message : 'Estrutura de dados recebida é inválida.',
    );
  }
}

export const api = {
  getMe: (signal: AbortSignal, onUnauthorized: () => void): Promise<SessionResponse> =>
    request(
      '/api/v1/me',
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => sessionResponseSchema.parse(raw),
    ),

  updateProfile: (
    data: UpdateProfileInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<SessionResponse> =>
    request(
      '/api/v1/me',
      { method: 'PATCH', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => sessionResponseSchema.parse(raw),
    ),

  changePassword: (
    data: ChangePasswordInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ success: boolean; revokedCount?: number }> =>
    request(
      '/api/v1/me/password',
      { method: 'POST', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => {
        const base = parseSuccessResponse(raw);
        const revokedCount =
          typeof (raw as Record<string, unknown>).revokedCount === 'number'
            ? ((raw as Record<string, unknown>).revokedCount as number)
            : undefined;
        return { ...base, revokedCount };
      },
    ),

  signIn: async (
    data: { email: string; password: string },
    signal?: AbortSignal,
  ): Promise<SessionResponse> => {
    const res = await fetch('/api/v1/auth/sign-in/email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
      signal,
    });
    if (!res.ok) {
      throw new ApiError(res.status, res.status === 429 ? 'RATE_LIMITED' : 'INVALID_CREDENTIALS');
    }
    const raw: unknown = await res.json();
    try {
      return sessionResponseSchema.parse(raw);
    } catch {
      throw new ApiError(500, 'INVALID_RESPONSE', 'Resposta de sessão inválida.');
    }
  },

  signOut: (signal?: AbortSignal): Promise<Response> =>
    fetch('/api/v1/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      signal,
    }),

  listClients: (
    params: { q?: string; status?: string; page?: number; pageSize?: number },
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ClientListResponse> => {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return request(
      `/api/v1/clients?${query.toString()}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => clientListResponseSchema.parse(raw),
    );
  },

  getClient: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ client: Client }> =>
    request(
      `/api/v1/clients/${id}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => clientResponseSchema.parse(raw),
    ),

  createClient: (
    data: CreateClientInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ client: Client }> =>
    request(
      '/api/v1/clients',
      { method: 'POST', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => clientResponseSchema.parse(raw),
    ),

  updateClient: (
    id: string,
    data: UpdateClientInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ client: Client }> =>
    request(
      `/api/v1/clients/${id}`,
      { method: 'PATCH', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => clientResponseSchema.parse(raw),
    ),

  archiveClient: (
    id: string,
    version: number,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ client: Client }> =>
    request(
      `/api/v1/clients/${id}/archive`,
      { method: 'POST', body: JSON.stringify({ version }), signal },
      onUnauthorized,
      (raw) => clientResponseSchema.parse(raw),
    ),

  restoreClient: (
    id: string,
    version: number,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ client: Client }> =>
    request(
      `/api/v1/clients/${id}/restore`,
      { method: 'POST', body: JSON.stringify({ version }), signal },
      onUnauthorized,
      (raw) => clientResponseSchema.parse(raw),
    ),

  listUsers: (
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ users: UserListItem[] }> =>
    request(
      '/api/v1/users',
      { method: 'GET', signal },
      onUnauthorized,
      parseUsersListResponse,
    ),

  createUser: (
    data: { name: string; email: string; password: string; role: string },
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ id: string; name: string; email: string }> =>
    request(
      '/api/v1/users',
      { method: 'POST', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => publicUserSchema.parse(raw),
    ),

  deactivateUser: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ success: boolean }> =>
    request(
      `/api/v1/users/${id}`,
      { method: 'PATCH', body: JSON.stringify({ active: false }), signal },
      onUnauthorized,
      parseSuccessResponse,
    ),

  changeUserRole: (
    id: string,
    role: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ success: boolean }> =>
    request(
      `/api/v1/users/${id}/role`,
      { method: 'PUT', body: JSON.stringify({ role }), signal },
      onUnauthorized,
      parseSuccessResponse,
    ),

  // ================= Fase 3 — Demandas =================

  listDemands: (
    params: { q?: string; status?: string; priority?: string; clientId?: string; page?: number; pageSize?: number },
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ demands: Demand[]; total: number; page: number; pageSize: number }> => {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.status) query.set('status', params.status);
    if (params.priority) query.set('priority', params.priority);
    if (params.clientId) query.set('clientId', params.clientId);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return request(
      `/api/v1/demands?${query.toString()}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => demandListResponseSchema.parse(raw),
    );
  },

  createDemand: (
    data: CreateDemandInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ demand: Demand }> =>
    request(
      '/api/v1/demands',
      { method: 'POST', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => demandResponseSchema.parse(raw),
    ),

  getDemand: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ demand: Demand; tasks: Task[] }> =>
    request(
      `/api/v1/demands/${id}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => demandDetailResponseSchema.parse(raw),
    ),

  updateDemand: (
    id: string,
    data: UpdateDemandInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ demand: Demand }> =>
    request(
      `/api/v1/demands/${id}`,
      { method: 'PATCH', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => demandResponseSchema.parse(raw),
    ),

  completeDemand: (
    id: string,
    input: CompleteDemandInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ demand: Demand }> =>
    request(
      `/api/v1/demands/${id}/complete`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => demandResponseSchema.parse(raw),
    ),

  getDemandHistory: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ events: DemandEvent[] }> =>
    request(
      `/api/v1/demands/${id}/history`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => demandHistoryResponseSchema.parse(raw),
    ),

  // ================= Fase 3 — Tarefas =================

  createTask: (
    data: CreateTaskInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      '/api/v1/tasks',
      { method: 'POST', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  getTask: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task; requirements: Requirement[]; dependencies: { id: string; satisfied: boolean }[] }> =>
    request(
      `/api/v1/tasks/${id}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => taskDetailResponseSchema.parse(raw),
    ),

  acceptTask: (
    id: string,
    input: TaskVersionInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/accept`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  startTask: (
    id: string,
    input: TaskVersionInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/start`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  submitTaskReview: (
    id: string,
    input: SubmitTaskReviewInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/submit-review`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  reviewTask: (
    id: string,
    input: ReviewTaskInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/review`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  requestTaskPause: (
    id: string,
    input: RequestTaskPauseInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/request-pause`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  approveTaskPause: (
    id: string,
    input: ApproveTaskPauseInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/approve-pause`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  resumeTask: (
    id: string,
    input: TaskVersionInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/resume`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  reassignTask: (
    id: string,
    input: ReassignTaskInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/reassign`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  updateTaskRequirement: (
    id: string,
    requirementId: string,
    input: UpdateRequirementInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/requirements/${requirementId}`,
      { method: 'PATCH', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  addTaskDependency: (
    id: string,
    input: AddDependencyInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/dependencies`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  removeTaskDependency: (
    id: string,
    dependencyId: string,
    input: RemoveDependencyInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ task: Task }> =>
    request(
      `/api/v1/tasks/${id}/dependencies/${dependencyId}`,
      { method: 'DELETE', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskResponseSchema.parse(raw),
    ),

  getTaskComments: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ comments: TaskComment[] }> =>
    request(
      `/api/v1/tasks/${id}/comments`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => taskCommentsResponseSchema.parse(raw),
    ),

  addTaskComment: (
    id: string,
    input: CreateTaskCommentInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ comments: TaskComment[] }> =>
    request(
      `/api/v1/tasks/${id}/comments`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => taskCommentsResponseSchema.parse(raw),
    ),

  // ================= Fase 4 — Dashboard =================

  getDashboard: (
    params: { limit?: number } | undefined,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<DashboardResponse> => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.size > 0 ? `?${query.toString()}` : '';
    return request(
      `/api/v1/dashboard${qs}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => dashboardResponseSchema.parse(raw),
    );
  },

  // ================= Fase 5 — Materiais =================

  getMaterials: (
    query: ListMaterialsQuery,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ListMaterialsResponse> => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.clientId) params.set('clientId', query.clientId);
    if (query.demandId) params.set('demandId', query.demandId);
    if (query.taskId) params.set('taskId', query.taskId);
    if (query.category) params.set('category', query.category);
    if (query.status) params.set('status', query.status);
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    return request(
      `/api/v1/materials${qs}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => listMaterialsResponseSchema.parse(raw),
    );
  },

  getMaterial: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ material: Material }> =>
    request(
      `/api/v1/materials/${id}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => ({ material: materialSchema.parse((raw as { material: unknown }).material) }),
    ),

  createMaterial: (
    input: CreateMaterialInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ material: Material }> =>
    request(
      '/api/v1/materials',
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => ({ material: materialSchema.parse((raw as { material: unknown }).material) }),
    ),

  updateMaterial: (
    id: string,
    input: UpdateMaterialInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ material: Material }> =>
    request(
      `/api/v1/materials/${id}`,
      { method: 'PATCH', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => ({ material: materialSchema.parse((raw as { material: unknown }).material) }),
    ),

  archiveMaterial: (
    id: string,
    version: number,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ material: Material }> =>
    request(
      `/api/v1/materials/${id}/archive`,
      { method: 'POST', body: JSON.stringify({ version }), signal },
      onUnauthorized,
      (raw) => ({ material: materialSchema.parse((raw as { material: unknown }).material) }),
    ),

  restoreMaterial: (
    id: string,
    version: number,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ material: Material }> =>
    request(
      `/api/v1/materials/${id}/restore`,
      { method: 'POST', body: JSON.stringify({ version }), signal },
      onUnauthorized,
      (raw) => ({ material: materialSchema.parse((raw as { material: unknown }).material) }),
    ),

  getMaterialHistory: (
    id: string,
    query: MaterialHistoryQuery | undefined,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<MaterialHistoryResponse> => {
    const params = new URLSearchParams();
    if (query?.page) params.set('page', String(query.page));
    if (query?.pageSize) params.set('pageSize', String(query.pageSize));
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    return request(
      `/api/v1/materials/${id}/history${qs}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => materialHistoryResponseSchema.parse(raw),
    );
  },

  getMaterialTargets: (
    query: ListMaterialTargetsQuery,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ListMaterialTargetsResponse> => {
    const params = new URLSearchParams();
    params.set('kind', query.kind);
    if (query.q) params.set('q', query.q);
    if (query.clientId) params.set('clientId', query.clientId);
    if (query.demandId) params.set('demandId', query.demandId);
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    return request(
      `/api/v1/materials/targets?${params.toString()}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => listMaterialTargetsResponseSchema.parse(raw),
    );
  },

  getClientTimeline: (
    clientId: string,
    query: ClientTimelineQuery | undefined,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ClientTimelineResponse> => {
    const params = new URLSearchParams();
    if (query?.page) params.set('page', String(query.page));
    if (query?.pageSize) params.set('pageSize', String(query.pageSize));
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    return request(
      `/api/v1/materials/client-timeline/${clientId}${qs}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => clientTimelineResponseSchema.parse(raw),
    );
  },

  // ================= Fase 7 — Notificações (central) =================

  listNotifications: (
    query: ListNotificationsQuery,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<NotificationListResponse> => {
    const params = new URLSearchParams();
    params.set('page', String(query.page));
    params.set('pageSize', String(query.pageSize));
    if (query.unreadOnly) params.set('unreadOnly', 'true');
    return request(
      `/api/v1/notifications?${params.toString()}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => notificationListResponseSchema.parse(raw),
    );
  },

  markNotificationRead: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<NotificationResponse> =>
    request(
      `/api/v1/notifications/${id}/read`,
      { method: 'POST', body: JSON.stringify({}), signal },
      onUnauthorized,
      (raw) => notificationResponseSchema.parse(raw),
    ),

  // ================= Fase 11 — Templates de Demandas =================

  listDemandTemplates: (
    params: { active?: boolean; category?: string },
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<DemandTemplateListResponse> => {
    const query = new URLSearchParams();
    if (params.active !== undefined) query.set('active', String(params.active));
    if (params.category) query.set('category', params.category);
    const qs = query.size > 0 ? `?${query.toString()}` : '';
    return request(
      `/api/v1/demand-templates${qs}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => demandTemplateListResponseSchema.parse(raw),
    );
  },

  createDemandTemplate: (
    input: CreateDemandTemplateInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<DemandTemplateResponse> =>
    request(
      '/api/v1/demand-templates',
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => demandTemplateResponseSchema.parse(raw),
    ),

  updateDemandTemplate: (
    id: string,
    input: UpdateDemandTemplateInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<DemandTemplateResponse> =>
    request(
      `/api/v1/demand-templates/${id}`,
      { method: 'PATCH', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => demandTemplateResponseSchema.parse(raw),
    ),

  instantiateDemandTemplate: (
    id: string,
    input: InstantiateDemandTemplateInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<DemandResponse> =>
    request(
      `/api/v1/demand-templates/${id}/instantiate`,
      { method: 'POST', body: JSON.stringify(input), signal },
      onUnauthorized,
      (raw) => demandResponseSchema.parse(raw),
    ),

  // ================= Fase 11 — Relatórios Operacionais =================

  getProductivityReport: (
    query: { startDate: string; endDate: string; clientId?: string; userId?: string },
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ProductivityReportResponse> => {
    const params = new URLSearchParams();
    params.set('startDate', query.startDate);
    params.set('endDate', query.endDate);
    if (query.clientId) params.set('clientId', query.clientId);
    if (query.userId) params.set('userId', query.userId);
    return request(
      `/api/v1/reports/productivity?${params.toString()}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => productivityReportResponseSchema.parse(raw),
    );
  },

  getBottlenecksReport: (
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<BottlenecksReportResponse> =>
    request(
      '/api/v1/reports/bottlenecks',
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => bottlenecksReportResponseSchema.parse(raw),
    ),

  // ================= Fase 10 — Backups & Google Drive =================

  getBackupStatus: (
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<BackupStatusResponse> =>
    request(
      '/api/v1/backups/status',
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => backupStatusResponseSchema.parse(raw),
    ),

  triggerBackup: (
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<TriggerBackupResponse> =>
    request(
      '/api/v1/backups/run',
      { method: 'POST', body: '{}', signal },
      onUnauthorized,
      (raw) => triggerBackupResponseSchema.parse(raw),
    ),

  // ================= Cofre de Credenciais & Hermes Agent =================

  getHermesStatus: (
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<HermesStatusResponse> =>
    request(
      '/api/v1/hermes/status',
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => hermesStatusResponseSchema.parse(raw),
    ),

  listClientCredentials: (
    params: { clientId?: string; search?: string },
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ClientCredentialListResponse> => {
    const query = new URLSearchParams();
    if (params.clientId) query.set('clientId', params.clientId);
    if (params.search) query.set('search', params.search);
    const qs = query.toString();
    return request(
      `/api/v1/vault/credentials${qs ? `?${qs}` : ''}`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => clientCredentialListResponseSchema.parse(raw),
    );
  },

  createClientCredential: (
    data: CreateClientCredentialInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ClientCredential> =>
    request(
      '/api/v1/vault/credentials',
      { method: 'POST', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => clientCredentialSchema.parse(raw),
    ),

  updateClientCredential: (
    id: string,
    data: UpdateClientCredentialInput,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ClientCredential> =>
    request(
      `/api/v1/vault/credentials/${id}`,
      { method: 'PATCH', body: JSON.stringify(data), signal },
      onUnauthorized,
      (raw) => clientCredentialSchema.parse(raw),
    ),

  revealClientCredentialSecret: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<ClientCredentialSecretResponse> =>
    request(
      `/api/v1/vault/credentials/${id}/reveal`,
      { method: 'GET', signal },
      onUnauthorized,
      (raw) => clientCredentialSecretResponseSchema.parse(raw),
    ),

  deleteClientCredential: (
    id: string,
    signal: AbortSignal,
    onUnauthorized: () => void,
  ): Promise<{ deleted: true }> =>
    request(
      `/api/v1/vault/credentials/${id}`,
      { method: 'DELETE', body: '{}', signal },
      onUnauthorized,
      () => ({ deleted: true as const }),
    ),
};
