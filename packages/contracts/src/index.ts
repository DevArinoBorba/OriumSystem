import { z } from 'zod';

export const roleSchema = z.enum(['administrator', 'collaborator']);
export type Role = z.infer<typeof roleSchema>;

export const permissionSchema = z.enum([
  'protected.read', 'users.read', 'users.create', 'users.deactivate', 'roles.manage',
  'clients.read', 'clients.read.assigned', 'clients.write', 'clients.manage', 'clients.team.manage', 'clients.archive',
  'demands.read', 'demands.write',
  'tasks.read', 'tasks.manage', 'tasks.execute', 'tasks.review',
  'materials.read', 'materials.write', 'materials.archive',
]);
export type Permission = z.infer<typeof permissionSchema>;

export const loginSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();
export const createUserSchema = loginSchema.extend({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(128),
  role: roleSchema.default('collaborator'),
});
export const avatarImageSchema = z.union([
  z.string().url(),
  z.string().startsWith('data:image/'),
]);
export const publicUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  image: avatarImageSchema.nullable().optional(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  image: avatarImageSchema.nullable().optional(),
}).strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
}).strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export const sessionResponseSchema = z.object({
  user: publicUserSchema, roles: z.array(roleSchema), permissions: z.array(permissionSchema),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export const changeRoleSchema = z.object({ role: roleSchema }).strict();
export const deactivateUserSchema = z.object({ active: z.literal(false) }).strict();
export const rolePermissionsSchema = z.object({ permissions: z.array(permissionSchema).max(20) }).strict();

// ==========================================
// FASE 2 & 2A: CLIENTES, ESCOPO CONTRATADO E EQUIPE
// ==========================================

export const clientContractStatusSchema = z.enum([
  'onboarding',
  'active',
  'paused',
  'offboarding',
  'archived',
]);
export const contractStatusSchema = clientContractStatusSchema;
export type ClientContractStatus = z.infer<typeof clientContractStatusSchema>;
export type ContractStatus = ClientContractStatus;

export const clientFunctionalRoleSchema = z.enum([
  'account_manager',
  'traffic_manager',
  'designer',
  'social_media',
  'copywriter',
  'developer',
  'video_maker',
]);
export const functionalRoleSchema = clientFunctionalRoleSchema;
export type ClientFunctionalRole = z.infer<typeof clientFunctionalRoleSchema>;
export type FunctionalRole = ClientFunctionalRole;

export const scopeCadenceSchema = z.enum([
  'one_off',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
]);
export type ScopeCadence = z.infer<typeof scopeCadenceSchema>;

export const scopeCategorySchema = z.enum([
  'traffic',
  'social_media',
  'design',
  'web',
  'copy',
  'video',
  'crm',
  'general',
]);
export type ScopeCategory = z.infer<typeof scopeCategorySchema>;

export const clientUrlSchema = z.string().trim().url().max(2048).refine((val) => {
  try {
    const parsed = new URL(val);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}, { message: 'URL deve utilizar protocolo HTTP/HTTPS e não conter credenciais embutidas' });

export const clientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(160).nullable(),
  email: z.string().trim().email().max(254).toLowerCase().nullable(),
  phone: z.string().trim().max(40).nullable(),
  notes: z.string().trim().max(4000).nullable(),
  contractStatus: clientContractStatusSchema.default('active'),
  segment: z.string().trim().max(160).nullable().default(null),
  accountManagerUserId: z.string().nullable().default(null),
  briefingSummary: z.string().max(10000).default(''),
  brandKitUrl: clientUrlSchema.nullable().default(null),
  driveFolderUrl: clientUrlSchema.nullable().default(null),
  activeChannels: z.array(z.string().trim().min(1).max(80)).default([]),
  onboardingCompletedAt: z.string().datetime({ offset: true }).nullable().default(null),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  version: z.number().int().positive(),
});
export type Client = z.infer<typeof clientSchema>;

export const createClientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().email().max(254).toLowerCase().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  contractStatus: clientContractStatusSchema.optional().default('active'),
  segment: z.string().trim().max(160).nullable().optional(),
  accountManagerUserId: z.string().trim().min(1).max(255).nullable().optional(),
  briefingSummary: z.string().trim().max(10000).optional().default(''),
  brandKitUrl: clientUrlSchema.nullable().optional(),
  driveFolderUrl: clientUrlSchema.nullable().optional(),
  activeChannels: z.array(z.string().trim().min(1).max(80)).max(30).optional().default([]),
  onboardingCompletedAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(160).optional(),
  contactName: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().email().max(254).toLowerCase().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  contractStatus: clientContractStatusSchema.optional(),
  segment: z.string().trim().max(160).nullable().optional(),
  accountManagerUserId: z.string().trim().min(1).max(255).nullable().optional(),
  briefingSummary: z.string().trim().max(10000).optional(),
  brandKitUrl: clientUrlSchema.nullable().optional(),
  driveFolderUrl: clientUrlSchema.nullable().optional(),
  activeChannels: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  onboardingCompletedAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().refine((data) => Object.keys(data).some((key) => key !== 'version'), {
  message: 'Pelo menos um campo editável deve ser fornecido.',
});
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientVersionSchema = z.object({
  version: z.number().int().positive(),
}).strict();
export type ClientVersionInput = z.infer<typeof clientVersionSchema>;

export const clientStatusFilterSchema = z.enum(['active', 'archived', 'all']);
export type ClientStatusFilter = z.infer<typeof clientStatusFilterSchema>;

export const listClientsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: clientStatusFilterSchema.default('active'),
  contractStatus: clientContractStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

export const clientResponseSchema = z.object({
  client: clientSchema,
});
export type ClientResponse = z.infer<typeof clientResponseSchema>;

export const clientListResponseSchema = z.object({
  clients: z.array(clientSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ClientListResponse = z.infer<typeof clientListResponseSchema>;

export const clientTeamMemberSchema = z.object({
  clientId: z.string().uuid(),
  userId: z.string(),
  userName: z.string(),
  userEmail: z.email(),
  functionalRole: clientFunctionalRoleSchema,
  isPrimary: z.boolean(),
  canCreateDemands: z.boolean(),
  assignedByUserId: z.string(),
  assignedAt: z.string().datetime({ offset: true }),
}).strict();
export type ClientTeamMember = z.infer<typeof clientTeamMemberSchema>;

export const upsertClientTeamMemberSchema = z.object({
  userId: z.string().trim().min(1).max(255),
  functionalRole: clientFunctionalRoleSchema,
  isPrimary: z.boolean().default(false),
  canCreateDemands: z.boolean().default(false),
}).strict();
export type UpsertClientTeamMemberInput = z.infer<typeof upsertClientTeamMemberSchema>;
export const assignClientTeamMemberSchema = upsertClientTeamMemberSchema;
export type AssignClientTeamMemberInput = UpsertClientTeamMemberInput;

export const clientTeamMemberResponseSchema = z.object({
  member: clientTeamMemberSchema,
}).strict();
export type ClientTeamMemberResponse = z.infer<typeof clientTeamMemberResponseSchema>;

export const clientTeamListResponseSchema = z.object({
  members: z.array(clientTeamMemberSchema),
}).strict();
export type ClientTeamListResponse = z.infer<typeof clientTeamListResponseSchema>;

export const clientScopeItemSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000),
  category: scopeCategorySchema,
  cadence: scopeCadenceSchema,
  contractedQuantity: z.number().int().positive(),
  slaBusinessDays: z.number().int().positive().nullable(),
  slaHours: z.number().int().positive().nullable(),
  active: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type ClientScopeItem = z.infer<typeof clientScopeItemSchema>;

export const createClientScopeItemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(''),
  category: scopeCategorySchema.default('general'),
  cadence: scopeCadenceSchema.default('monthly'),
  contractedQuantity: z.number().int().positive().default(1),
  slaBusinessDays: z.number().int().positive().nullable().optional(),
  slaHours: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict();
export type CreateClientScopeItemInput = z.infer<typeof createClientScopeItemSchema>;

export const updateClientScopeItemSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  category: scopeCategorySchema.optional(),
  cadence: scopeCadenceSchema.optional(),
  contractedQuantity: z.number().int().positive().optional(),
  slaBusinessDays: z.number().int().positive().nullable().optional(),
  slaHours: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).some((key) => key !== 'version'), {
  message: 'Pelo menos um campo editável deve ser fornecido.',
});
export type UpdateClientScopeItemInput = z.infer<typeof updateClientScopeItemSchema>;

export const clientScopeItemResponseSchema = z.object({
  scopeItem: clientScopeItemSchema,
}).strict();
export type ClientScopeItemResponse = z.infer<typeof clientScopeItemResponseSchema>;

export const clientScopeListResponseSchema = z.object({
  scopeItems: z.array(clientScopeItemSchema),
}).strict();
export type ClientScopeListResponse = z.infer<typeof clientScopeListResponseSchema>;

// ==========================================
// FASE 3: DEMANDAS E TAREFAS
// ==========================================

export const calendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data deve ser YYYY-MM-DD')
  .refine((val) => {
    const [yearStr, monthStr, dayStr] = val.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (month < 1 || month > 12) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, { message: 'Data inválida no calendário' });

export const demandPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type DemandPriority = z.infer<typeof demandPrioritySchema>;

export const demandStatusSchema = z.enum(['open', 'completed']);
export type DemandStatus = z.infer<typeof demandStatusSchema>;

export const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskStatusSchema = z.enum([
  'blocked',
  'ready',
  'in_production',
  'in_review',
  'changes_requested',
  'paused',
  'completed',
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const demandClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
}).strict();
export type DemandClient = z.infer<typeof demandClientSchema>;

export const demandSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  client: demandClientSchema,
  createdByUserId: z.string(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000),
  priority: demandPrioritySchema,
  deliveryDate: calendarDateSchema,
  status: demandStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type Demand = z.infer<typeof demandSchema>;

export const previewUrlSchema = z.string().trim().max(2000).refine((val) => {
  try {
    const u = new URL(val);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}, { message: 'URL de preview deve usar protocolo http ou https' });
export type PreviewUrl = z.infer<typeof previewUrlSchema>;

export const taskSchema = z.object({
  id: z.string().uuid(),
  demandId: z.string().uuid(),
  assignedToUserId: z.string(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000),
  priority: taskPrioritySchema,
  deliveryDate: calendarDateSchema,
  status: taskStatusSchema,
  acceptedAt: z.string().datetime({ offset: true }).nullable(),
  readyAt: z.string().datetime({ offset: true }).nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  pauseRequestedAt: z.string().datetime({ offset: true }).nullable(),
  pauseReason: z.string().max(1000).nullable(),
  deliveryNotes: z.string().max(2_500_000).nullable(),
  previewUrl: previewUrlSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type Task = z.infer<typeof taskSchema>;

export const requirementSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  mandatory: z.boolean(),
  satisfied: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type Requirement = z.infer<typeof requirementSchema>;

export const taskDependencyRefSchema = z.object({
  id: z.string().uuid(),
  satisfied: z.boolean(),
}).strict();
export type TaskDependencyRef = z.infer<typeof taskDependencyRefSchema>;

export const taskCommentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  authorId: z.string(),
  authorName: z.string(),
  content: z.string().min(1).max(2_500_000),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const demandEventSchema = z.object({
  id: z.string().uuid(),
  demandId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  actorId: z.string(),
  actorName: z.string(),
  action: z.string(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type DemandEvent = z.infer<typeof demandEventSchema>;

// Inputs
export const createDemandSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000).default(''),
  priority: demandPrioritySchema.default('normal'),
  deliveryDate: calendarDateSchema,
}).strict();
export type CreateDemandInput = z.infer<typeof createDemandSchema>;

export const updateDemandSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(5000).optional(),
  priority: demandPrioritySchema.optional(),
  deliveryDate: calendarDateSchema.optional(),
}).strict().refine((data) => Object.keys(data).some((key) => key !== 'version'), {
  message: 'Pelo menos um campo editável deve ser fornecido.',
});
export type UpdateDemandInput = z.infer<typeof updateDemandSchema>;

export const completeDemandSchema = z.object({
  version: z.number().int().positive(),
}).strict();
export type CompleteDemandInput = z.infer<typeof completeDemandSchema>;

export const taskRequirementInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  mandatory: z.boolean().default(true),
}).strict();
export type TaskRequirementInput = z.infer<typeof taskRequirementInputSchema>;

export const createTaskSchema = z.object({
  demandId: z.string().uuid(),
  assignedToUserId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000).default(''),
  priority: taskPrioritySchema.default('normal'),
  deliveryDate: calendarDateSchema.optional(),
  requirements: z.array(taskRequirementInputSchema).max(30).default([]),
  dependsOnTaskIds: z.array(z.string().uuid()).max(30).default([]),
}).strict();
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const taskVersionSchema = z.object({
  version: z.number().int().positive(),
}).strict();
export type TaskVersionInput = z.infer<typeof taskVersionSchema>;

export const reassignTaskSchema = z.object({
  version: z.number().int().positive(),
  assignedToUserId: z.string().min(1),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type ReassignTaskInput = z.infer<typeof reassignTaskSchema>;

export const updateRequirementSchema = z.object({
  version: z.number().int().positive(),
  satisfied: z.boolean(),
}).strict();
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

export const addDependencySchema = z.object({
  version: z.number().int().positive(),
  dependsOnTaskId: z.string().uuid(),
}).strict();
export type AddDependencyInput = z.infer<typeof addDependencySchema>;

export const removeDependencySchema = z.object({
  version: z.number().int().positive(),
}).strict();
export type RemoveDependencyInput = z.infer<typeof removeDependencySchema>;

export const submitTaskReviewSchema = z.object({
  version: z.number().int().positive(),
  deliveryNotes: z.string().trim().min(1).max(2_500_000),
  previewUrl: previewUrlSchema.optional().nullable(),
}).strict();
export type SubmitTaskReviewInput = z.infer<typeof submitTaskReviewSchema>;

export const reviewTaskSchema = z.object({
  version: z.number().int().positive(),
  decision: z.enum(['complete', 'changes_requested']),
  feedback: z.string().trim().min(1).max(2_500_000),
}).strict();
export type ReviewTaskInput = z.infer<typeof reviewTaskSchema>;

export const requestTaskPauseSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type RequestTaskPauseInput = z.infer<typeof requestTaskPauseSchema>;

export const approveTaskPauseSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
  deliveryDate: calendarDateSchema,
}).strict();
export type ApproveTaskPauseInput = z.infer<typeof approveTaskPauseSchema>;

export const createTaskCommentSchema = z.object({
  content: z.string().trim().min(1).max(2_500_000),
}).strict();
export type CreateTaskCommentInput = z.infer<typeof createTaskCommentSchema>;

// Queries
export const listDemandsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['open', 'completed', 'all']).default('all'),
  priority: z.enum(['low', 'normal', 'high', 'urgent', 'all']).default('all'),
  clientId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListDemandsQuery = z.infer<typeof listDemandsQuerySchema>;

// Responses
export const demandResponseSchema = z.object({
  demand: demandSchema,
}).strict();
export type DemandResponse = z.infer<typeof demandResponseSchema>;

export const demandListResponseSchema = z.object({
  demands: z.array(demandSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
}).strict();
export type DemandListResponse = z.infer<typeof demandListResponseSchema>;

export const demandDetailResponseSchema = z.object({
  demand: demandSchema,
  tasks: z.array(taskSchema),
}).strict();
export type DemandDetailResponse = z.infer<typeof demandDetailResponseSchema>;

export const taskResponseSchema = z.object({
  task: taskSchema,
}).strict();
export type TaskResponse = z.infer<typeof taskResponseSchema>;

export const taskDetailResponseSchema = z.object({
  task: taskSchema,
  requirements: z.array(requirementSchema),
  dependencies: z.array(taskDependencyRefSchema),
}).strict();
export type TaskDetailResponse = z.infer<typeof taskDetailResponseSchema>;

export const taskCommentsResponseSchema = z.object({
  comments: z.array(taskCommentSchema),
}).strict();
export type TaskCommentsResponse = z.infer<typeof taskCommentsResponseSchema>;

export const demandHistoryResponseSchema = z.object({
  events: z.array(demandEventSchema),
}).strict();
export type DemandHistoryResponse = z.infer<typeof demandHistoryResponseSchema>;

// ==========================================
// FASE 4: DASHBOARD OPERACIONAL
// ==========================================

export const dashboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardItemKindSchema = z.enum(['task', 'demand']);
export type DashboardItemKind = z.infer<typeof dashboardItemKindSchema>;

export const dashboardItemClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
}).strict();
export type DashboardItemClient = z.infer<typeof dashboardItemClientSchema>;

export const dashboardItemUserSchema = z.object({
  id: z.string(),
  name: z.string(),
}).strict();
export type DashboardItemUser = z.infer<typeof dashboardItemUserSchema>;

export const dashboardTaskItemSchema = z.object({
  kind: z.literal('task'),
  id: z.string().uuid(),
  title: z.string(),
  demandId: z.string().uuid(),
  demandTitle: z.string(),
  client: dashboardItemClientSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  deliveryDate: calendarDateSchema,
  taskId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  /** Quando os requisitos foram atendidos (PRONTA PARA INICIAR); mede a espera na fila. */
  readyAt: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().nullable().optional(),
  assignedTo: dashboardItemUserSchema.nullable().optional(),
}).strict();
export type DashboardTaskItem = z.infer<typeof dashboardTaskItemSchema>;

export const dashboardDemandItemSchema = z.object({
  kind: z.literal('demand'),
  id: z.string().uuid(),
  title: z.string(),
  demandId: z.string().uuid(),
  demandTitle: z.string(),
  client: dashboardItemClientSchema,
  status: demandStatusSchema,
  priority: demandPrioritySchema,
  deliveryDate: calendarDateSchema,
  taskId: z.string().uuid().nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().nullable().optional(),
  assignedTo: dashboardItemUserSchema.nullable().optional(),
}).strict();
export type DashboardDemandItem = z.infer<typeof dashboardDemandItemSchema>;

export const dashboardItemSchema = z.discriminatedUnion('kind', [
  dashboardTaskItemSchema,
  dashboardDemandItemSchema,
]);
export type DashboardItem = z.infer<typeof dashboardItemSchema>;

export const dashboardSectionSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(dashboardItemSchema),
}).strict();
export type DashboardSection = z.infer<typeof dashboardSectionSchema>;

export const dashboardWorkloadUserSchema = z.object({
  userId: z.string(),
  name: z.string(),
  active: z.boolean(),
  total: z.number().int().nonnegative(),
  production: z.number().int().nonnegative(),
  awaitingAction: z.number().int().nonnegative(),
}).strict();
export type DashboardWorkloadUser = z.infer<typeof dashboardWorkloadUserSchema>;

export const dashboardResponseSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  today: calendarDateSchema,
  timeZone: z.literal('America/Cuiaba'),
  upcomingDays: z.literal(3),
  scope: z.enum(['all', 'assigned']),
  sections: z.object({
    production: dashboardSectionSchema,
    awaitingAction: dashboardSectionSchema,
    overdueTasks: dashboardSectionSchema,
    overdueDemands: dashboardSectionSchema,
    dueToday: dashboardSectionSchema,
    upcoming: dashboardSectionSchema,
    urgent: dashboardSectionSchema,
  }).strict(),
  workload: z.array(dashboardWorkloadUserSchema),
  workloadAvailable: z.boolean(),
}).strict();
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

// ==========================================
// Fase 5 — Materiais, Links e Histórico
// ==========================================

export const materialCategorySchema = z.enum([
  'brand',
  'preview',
  'published',
  'drive',
  'asset',
  'reference',
]);
export type MaterialCategory = z.infer<typeof materialCategorySchema>;

export const materialUrlSchema = z.string().trim().url().max(2048).refine((val) => {
  try {
    const parsed = new URL(val);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}, { message: 'URL deve utilizar protocolo HTTP/HTTPS e não conter credenciais embutidas' });

export const materialClientProjectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
}).strict();
export type MaterialClientProjection = z.infer<typeof materialClientProjectionSchema>;

export const materialDemandProjectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
}).strict();
export type MaterialDemandProjection = z.infer<typeof materialDemandProjectionSchema>;

export const materialTaskProjectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
}).strict();
export type MaterialTaskProjection = z.infer<typeof materialTaskProjectionSchema>;

export const materialSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  client: materialClientProjectionSchema,
  demandId: z.string().uuid().nullable(),
  demand: materialDemandProjectionSchema.nullable(),
  taskId: z.string().uuid().nullable(),
  task: materialTaskProjectionSchema.nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
  category: materialCategorySchema,
  url: materialUrlSchema,
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type Material = z.infer<typeof materialSchema>;

export const listMaterialsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  clientId: z.string().uuid().optional(),
  demandId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  category: materialCategorySchema.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type ListMaterialsQuery = z.infer<typeof listMaterialsQuerySchema>;

export const listMaterialsResponseSchema = z.object({
  materials: z.array(materialSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
}).strict();
export type ListMaterialsResponse = z.infer<typeof listMaterialsResponseSchema>;

export const createMaterialSchema = z.object({
  clientId: z.string().uuid(),
  demandId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().default(''),
  category: materialCategorySchema,
  url: materialUrlSchema,
}).strict();
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = z.object({
  clientId: z.string().uuid().optional(),
  demandId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().default(''),
  category: materialCategorySchema,
  url: materialUrlSchema,
  version: z.number().int().positive(),
}).strict();
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;

export const materialVersionInputSchema = z.object({
  version: z.number().int().positive(),
}).strict();
export type MaterialVersionInput = z.infer<typeof materialVersionInputSchema>;

export const materialHistoryChangeFieldSchema = z.object({
  before: z.unknown(),
  after: z.unknown(),
}).strict();
export type MaterialHistoryChangeField = z.infer<typeof materialHistoryChangeFieldSchema>;

export const materialHistoryEventSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  actorName: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  changes: z.record(z.string(), materialHistoryChangeFieldSchema),
}).strict();
export type MaterialHistoryEvent = z.infer<typeof materialHistoryEventSchema>;

export const materialHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type MaterialHistoryQuery = z.infer<typeof materialHistoryQuerySchema>;

export const materialHistoryResponseSchema = z.object({
  events: z.array(materialHistoryEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
}).strict();
export type MaterialHistoryResponse = z.infer<typeof materialHistoryResponseSchema>;

export const listMaterialTargetsQuerySchema = z.object({
  kind: z.enum(['client', 'demand', 'task']),
  q: z.string().trim().max(100).optional(),
  clientId: z.string().uuid().optional(),
  demandId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type ListMaterialTargetsQuery = z.infer<typeof listMaterialTargetsQuerySchema>;

export const materialTargetSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  clientId: z.string().uuid().optional(),
  demandId: z.string().uuid().optional(),
}).strict();
export type MaterialTarget = z.infer<typeof materialTargetSchema>;

export const listMaterialTargetsResponseSchema = z.object({
  targets: z.array(materialTargetSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
}).strict();
export type ListMaterialTargetsResponse = z.infer<typeof listMaterialTargetsResponseSchema>;

export const timelineEventSourceSchema = z.enum(['demand', 'task', 'material']);
export type TimelineEventSource = z.infer<typeof timelineEventSourceSchema>;

export const clientTimelineEventSchema = z.object({
  id: z.string().uuid(),
  source: timelineEventSourceSchema,
  sourceId: z.string().uuid(),
  demandId: z.string().uuid().nullable(),
  taskId: z.string().uuid().nullable(),
  materialId: z.string().uuid().nullable(),
  title: z.string(),
  action: z.string(),
  actorName: z.string(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ClientTimelineEvent = z.infer<typeof clientTimelineEventSchema>;

export const clientTimelineQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type ClientTimelineQuery = z.infer<typeof clientTimelineQuerySchema>;

export const clientTimelineClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
}).strict();
export type ClientTimelineClient = z.infer<typeof clientTimelineClientSchema>;

export const clientTimelineResponseSchema = z.object({
  client: clientTimelineClientSchema,
  events: z.array(clientTimelineEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
}).strict();
export type ClientTimelineResponse = z.infer<typeof clientTimelineResponseSchema>;

// Fase 6 — auditoria de identidade. Projeção pública mínima: sem nome/e-mail,
// senha/hash, sessão/token, IP/user-agent, texto livre ou subjects de terceiros.
export const identityEventActionSchema = z.enum([
  'user_created',
  'user_role_changed',
  'user_deactivated',
  'role_permissions_changed',
  'password_recovered',
  'profile_updated',
  'password_changed',
]);
export type IdentityEventAction = z.infer<typeof identityEventActionSchema>;

const identityUserIdSchema = z.string().min(1).max(255);

export const identityPermissionListSchema = z.array(permissionSchema).refine(
  (list) => list.every((item, index) => index === 0 || list[index - 1]! < item),
  { message: 'Permissions must be sorted and unique.' },
);

const identityEventBase = {
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
};

export const identityEventSchema = z.discriminatedUnion('action', [
  z.object({
    ...identityEventBase,
    action: z.literal('user_created'),
    actorId: identityUserIdSchema.nullable(),
    targetUserId: identityUserIdSchema,
    newRole: roleSchema,
    newActive: z.literal(true),
  }).strict(),
  z.object({
    ...identityEventBase,
    action: z.literal('user_role_changed'),
    actorId: identityUserIdSchema,
    targetUserId: identityUserIdSchema,
    previousRole: roleSchema,
    newRole: roleSchema,
    revokedCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ...identityEventBase,
    action: z.literal('user_deactivated'),
    actorId: identityUserIdSchema,
    targetUserId: identityUserIdSchema,
    previousActive: z.boolean(),
    newActive: z.literal(false),
    revokedCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ...identityEventBase,
    action: z.literal('role_permissions_changed'),
    actorId: identityUserIdSchema,
    targetRoleId: roleSchema,
    previousPermissions: identityPermissionListSchema,
    newPermissions: identityPermissionListSchema,
    revokedCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ...identityEventBase,
    action: z.literal('password_recovered'),
    actorId: identityUserIdSchema,
    targetUserId: identityUserIdSchema,
    revokedCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ...identityEventBase,
    action: z.literal('profile_updated'),
    actorId: identityUserIdSchema,
    targetUserId: identityUserIdSchema,
    revokedCount: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ...identityEventBase,
    action: z.literal('password_changed'),
    actorId: identityUserIdSchema,
    targetUserId: identityUserIdSchema,
    revokedCount: z.number().int().nonnegative(),
  }).strict(),
]);
export type IdentityEvent = z.infer<typeof identityEventSchema>;

export const identityEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  action: identityEventActionSchema.optional(),
  targetUserId: z.string().uuid().optional(),
}).strict();
export type IdentityEventsQuery = z.infer<typeof identityEventsQuerySchema>;

export const identityEventsResponseSchema = z.object({
  events: z.array(identityEventSchema),
  nextCursor: z.string().min(1).nullable(),
}).strict();
export type IdentityEventsResponse = z.infer<typeof identityEventsResponseSchema>;

// ==========================================
// FASE 7: NOTIFICAÇÕES (central — schemas/tipos compartilhados)
// ==========================================
// Contrato estável da interface: docs/PHASE7-NOTIFICATIONS-CONTRACT.md.
// Nenhum campo privado de sessão entra nestes contratos públicos.

export const notificationKindSchema = z.enum([
  'task_assigned',
  'task_unblocked',
  'task_comment',
  'task_review_submitted',
  'task_changes_requested',
  'task_approved',
  'task_important_change',
  'demand_important_change',
  'task_due_today',
  'task_due_soon',
  'task_overdue',
  'demand_overdue',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  kind: notificationKindSchema,
  demandId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  demandTitle: z.string().trim().min(1).max(160),
  taskTitle: z.string().trim().max(160).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  readAt: z.string().datetime({ offset: true }).nullable(),
  deliveryDate: calendarDateSchema.nullable(),
}).strict();
export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.preprocess(
    (value) => {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    },
    z.boolean(),
  ).default(false),
}).strict();
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(50),
  total: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationResponseSchema = z.object({
  notification: notificationSchema,
}).strict();
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

// ==========================================
// FASE 11: REFINAMENTO — TEMPLATES E RELATÓRIOS
// ==========================================

export const demandTemplateCategorySchema = z.enum([
  'web',
  'design',
  'video',
  'marketing',
  'social_media',
  'general',
]);
export type DemandTemplateCategory = z.infer<typeof demandTemplateCategorySchema>;

export const templateRequirementInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mandatory: z.boolean().default(true),
  orderIndex: z.number().int().nonnegative().default(0),
}).strict();
export type TemplateRequirementInput = z.infer<typeof templateRequirementInputSchema>;

export const templateTaskInputSchema = z.object({
  tempId: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).default(''),
  suggestedRole: roleSchema.default('collaborator'),
  priority: taskPrioritySchema.default('normal'),
  dayOffsetStart: z.number().int().nonnegative().default(0),
  durationDays: z.number().int().positive().default(1),
  orderIndex: z.number().int().nonnegative().default(0),
  dependsOnTempIds: z.array(z.string().trim().min(1)).default([]),
  requirements: z.array(templateRequirementInputSchema).default([]),
}).strict();
export type TemplateTaskInput = z.infer<typeof templateTaskInputSchema>;

export const createDemandTemplateInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).default(''),
  category: demandTemplateCategorySchema.default('general'),
  defaultPriority: demandPrioritySchema.default('normal'),
  estimatedDays: z.number().int().positive().default(5),
  tasks: z.array(templateTaskInputSchema).min(1),
}).strict();
export type CreateDemandTemplateInput = z.infer<typeof createDemandTemplateInputSchema>;

export const updateDemandTemplateInputSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  category: demandTemplateCategorySchema.optional(),
  defaultPriority: demandPrioritySchema.optional(),
  estimatedDays: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  tasks: z.array(templateTaskInputSchema).min(1).optional(),
}).strict().refine((data) => Object.keys(data).some((k) => k !== 'version'), {
  message: 'Pelo menos um campo editável deve ser fornecido.',
});
export type UpdateDemandTemplateInput = z.infer<typeof updateDemandTemplateInputSchema>;

export const instantiateDemandTemplateInputSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  priority: demandPrioritySchema.optional(),
  startDate: calendarDateSchema.optional(),
  deliveryDate: calendarDateSchema.optional(),
  assignments: z.record(z.string(), z.string()).optional(),
}).strict();
export type InstantiateDemandTemplateInput = z.infer<typeof instantiateDemandTemplateInputSchema>;

export const demandTemplateTaskRequirementSchema = z.object({
  id: z.string().uuid(),
  templateTaskId: z.string().uuid(),
  title: z.string(),
  mandatory: z.boolean(),
  orderIndex: z.number().int(),
}).strict();
export type DemandTemplateTaskRequirement = z.infer<typeof demandTemplateTaskRequirementSchema>;

export const demandTemplateTaskSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  suggestedRole: z.string(),
  priority: taskPrioritySchema,
  dayOffsetStart: z.number().int(),
  durationDays: z.number().int(),
  orderIndex: z.number().int(),
  requirements: z.array(demandTemplateTaskRequirementSchema),
  dependsOnTaskIds: z.array(z.string().uuid()),
}).strict();
export type DemandTemplateTask = z.infer<typeof demandTemplateTaskSchema>;

export const demandTemplateSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  category: demandTemplateCategorySchema,
  defaultPriority: demandPrioritySchema,
  estimatedDays: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  tasks: z.array(demandTemplateTaskSchema),
}).strict();
export type DemandTemplate = z.infer<typeof demandTemplateSchema>;

export const demandTemplateResponseSchema = z.object({
  template: demandTemplateSchema,
}).strict();
export type DemandTemplateResponse = z.infer<typeof demandTemplateResponseSchema>;

export const demandTemplateListResponseSchema = z.object({
  templates: z.array(demandTemplateSchema),
  total: z.number().int().nonnegative(),
}).strict();
export type DemandTemplateListResponse = z.infer<typeof demandTemplateListResponseSchema>;

export const reportQuerySchema = z.object({
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  clientId: z.string().uuid().optional(),
  userId: z.string().optional(),
}).strict().refine((data) => data.startDate <= data.endDate, {
  message: 'startDate deve ser anterior ou igual a endDate',
  path: ['startDate'],
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const productivityReportResponseSchema = z.object({
  period: z.object({
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  }).strict(),
  summary: z.object({
    demandsCreated: z.number().int().nonnegative(),
    demandsCompleted: z.number().int().nonnegative(),
    tasksCompleted: z.number().int().nonnegative(),
    onTimeDeliveryRate: z.number().min(0).max(100),
    averageLeadTimeHours: z.number().nonnegative(),
    averageCycleTimeHours: z.number().nonnegative(),
  }).strict(),
  byAssignee: z.array(z.object({
    userId: z.string(),
    userName: z.string(),
    tasksCompleted: z.number().int().nonnegative(),
    averageCycleTimeHours: z.number().nonnegative(),
    onTimeRate: z.number().min(0).max(100),
  }).strict()),
}).strict();
export type ProductivityReportResponse = z.infer<typeof productivityReportResponseSchema>;

export const bottlenecksReportResponseSchema = z.object({
  summary: z.object({
    currentlyBlockedTasks: z.number().int().nonnegative(),
    currentlyPausedTasks: z.number().int().nonnegative(),
    currentlyInReviewTasks: z.number().int().nonnegative(),
    overdueOpenTasks: z.number().int().nonnegative(),
  }).strict(),
  stageAverages: z.object({
    averageReadyWaitHours: z.number().nonnegative(),
    averageProductionHours: z.number().nonnegative(),
    averagePauseCount: z.number().nonnegative(),
  }).strict(),
  pausedTasks: z.array(z.object({
    taskId: z.string().uuid(),
    taskTitle: z.string(),
    demandId: z.string().uuid(),
    demandTitle: z.string(),
    clientName: z.string(),
    assignedToName: z.string(),
    status: taskStatusSchema,
    pauseReason: z.string().nullable(),
    daysInCurrentStatus: z.number().nonnegative(),
  }).strict()),
}).strict();
export type BottlenecksReportResponse = z.infer<typeof bottlenecksReportResponseSchema>;

// ==========================================
// FASE 10: BACKUPS & GOOGLE DRIVE (RCLONE CRYPT)
// ==========================================

export const backupFileItemSchema = z.object({
  file: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().nullable().optional(),
}).strict();
export type BackupFileItem = z.infer<typeof backupFileItemSchema>;

export const backupStatusResponseSchema = z.object({
  ok: z.boolean(),
  stage: z.string(),
  lastStageFailed: z.string().nullable().optional(),
  stamp: z.string().nullable(),
  latestFile: z.string().nullable(),
  ageSec: z.number().nullable(),
  rpoSec: z.number().int().positive(),
  retentionDays: z.number().int().positive(),
  retentionMode: z.string(),
  driveConfigured: z.boolean(),
  dryRun: z.boolean(),
  driveFolder: z.string(),
  remoteName: z.string(),
  schedule: z.string(),
  files: z.array(backupFileItemSchema),
  totalBytes: z.number().int().nonnegative(),
}).strict();
export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>;

export const triggerBackupResponseSchema = z.object({
  success: z.boolean(),
  stamp: z.string(),
  file: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  driveUploaded: z.boolean(),
  driveMode: z.enum(['uploaded', 'dryrun', 'local_only']),
  message: z.string(),
  status: backupStatusResponseSchema,
}).strict();
export type TriggerBackupResponse = z.infer<typeof triggerBackupResponseSchema>;

// ==========================================
// FASE 6 & FASE 9: COFRE DE CREDENCIAIS (AES-256-GCM) & AGENTE HERMES
// ==========================================

export const clientCredentialCategorySchema = z.enum([
  'hosting',
  'domain',
  'cms',
  'ads',
  'social',
  'analytics',
  'email',
  'database',
  'other',
]);
export type ClientCredentialCategory = z.infer<typeof clientCredentialCategorySchema>;

export const clientCredentialSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  clientName: z.string().optional(),
  category: clientCredentialCategorySchema,
  label: z.string(),
  serviceUrl: z.string().nullable(),
  username: z.string(),
  secretPreview: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable().optional(),
}).strict();
export type ClientCredential = z.infer<typeof clientCredentialSchema>;

export const clientCredentialListResponseSchema = z.object({
  credentials: z.array(clientCredentialSchema),
}).strict();
export type ClientCredentialListResponse = z.infer<typeof clientCredentialListResponseSchema>;

export const clientCredentialSecretResponseSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  clientName: z.string().optional(),
  category: clientCredentialCategorySchema.optional(),
  label: z.string(),
  serviceUrl: z.string().nullable(),
  username: z.string(),
  secret: z.string(),
  notes: z.string().nullable(),
}).strict();
export type ClientCredentialSecretResponse = z.infer<typeof clientCredentialSecretResponseSchema>;

export const createClientCredentialSchema = z.object({
  clientId: z.string().uuid(),
  category: clientCredentialCategorySchema.default('hosting'),
  label: z.string().trim().min(2).max(100),
  serviceUrl: z.string().trim().max(500).nullable().optional(),
  username: z.string().trim().min(1).max(160),
  secret: z.string().min(1).max(500),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();
export type CreateClientCredentialInput = z.infer<typeof createClientCredentialSchema>;

export const updateClientCredentialSchema = z.object({
  category: clientCredentialCategorySchema.optional(),
  label: z.string().trim().min(2).max(100).optional(),
  serviceUrl: z.string().trim().max(500).nullable().optional(),
  username: z.string().trim().min(1).max(160).optional(),
  secret: z.string().min(1).max(500).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();
export type UpdateClientCredentialInput = z.infer<typeof updateClientCredentialSchema>;

export const hermesStatusResponseSchema = z.object({
  installed: z.boolean(),
  version: z.string(),
  omnirouteUrl: z.string(),
  omnirouteHealthy: z.boolean(),
  whatsappConfigured: z.boolean(),
  skillInstalled: z.boolean(),
  totalCredentials: z.number().int().nonnegative(),
  totalClients: z.number().int().nonnegative(),
  capabilities: z.array(z.string()),
}).strict();
export type HermesStatusResponse = z.infer<typeof hermesStatusResponseSchema>;
