import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const time = (name: string) => timestamp(name, { withTimezone: true });
export const user = pgTable('auth_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  active: boolean('active').notNull().default(true),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
});
export const session = pgTable('auth_session', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: time('expires_at').notNull(), createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(), lastSeenAt: time('last_seen_at').notNull().defaultNow(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
}, (table) => [index('session_user_idx').on(table.userId)]);
export const account = pgTable('auth_account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  password: text('password'), accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: time('access_token_expires_at'), refreshTokenExpiresAt: time('refresh_token_expires_at'), scope: text('scope'),
  createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [uniqueIndex('account_provider_key').on(table.providerId, table.accountId), index('account_user_idx').on(table.userId)]);
export const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: time('expires_at').notNull(), createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow(),
});
export const role = pgTable('role', { id: text('id').primaryKey(), name: text('name').notNull() });
export const permission = pgTable('permission', { id: text('id').primaryKey() });
export const userRole = pgTable('user_role', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => role.id),
});
export const rolePermission = pgTable('role_permission', {
  roleId: text('role_id').notNull().references(() => role.id), permissionId: text('permission_id').notNull().references(() => permission.id),
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]);

export const client = pgTable('client', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  notes: text('notes'),
  contractStatus: text('contract_status').notNull().default('active'),
  segment: text('segment'),
  accountManagerUserId: text('account_manager_user_id').references(() => user.id, { onDelete: 'set null' }),
  briefingSummary: text('briefing_summary').notNull().default(''),
  brandKitUrl: text('brand_kit_url'),
  driveFolderUrl: text('drive_folder_url'),
  activeChannels: text('active_channels').array().notNull().default([]),
  onboardingCompletedAt: time('onboarding_completed_at'),
  archivedAt: time('archived_at'),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => [
  index('client_name_idx').on(table.name),
  index('client_archived_at_idx').on(table.archivedAt),
  index('client_created_at_idx').on(table.createdAt),
  index('client_contract_status_idx').on(table.contractStatus),
  index('client_account_manager_idx').on(table.accountManagerUserId),
]);

export const clientTeamMember = pgTable('client_team_member', {
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  functionalRole: text('functional_role').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  canCreateDemands: boolean('can_create_demands').notNull().default(false),
  assignedByUserId: text('assigned_by_user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
  assignedAt: time('assigned_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.clientId, table.userId, table.functionalRole] }),
  index('client_team_member_user_idx').on(table.userId, table.clientId),
  index('client_team_member_client_idx').on(table.clientId),
]);

export const clientScopeItem = pgTable('client_scope_item', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('general'),
  cadence: text('cadence').notNull().default('monthly'),
  contractedQuantity: integer('contracted_quantity').notNull().default(1),
  slaBusinessDays: integer('sla_business_days'),
  slaHours: integer('sla_hours'),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [
  index('client_scope_item_client_active_idx').on(table.clientId, table.active),
  index('client_scope_item_category_idx').on(table.category),
]);

export const demand = pgTable('demand', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull().references(() => client.id),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  priority: text('priority').notNull().default('normal'),
  deliveryDate: date('delivery_date').notNull(),
  status: text('status').notNull().default('open'),
  version: integer('version').notNull().default(1),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [
  index('demand_client_id_idx').on(table.clientId),
  index('demand_created_by_user_id_idx').on(table.createdByUserId),
  index('demand_status_idx').on(table.status),
  index('demand_delivery_date_idx').on(table.deliveryDate),
  index('demand_created_at_idx').on(table.createdAt),
  index('demand_status_created_at_idx').on(table.status, table.createdAt),
  index('demand_client_status_delivery_idx').on(table.clientId, table.status, table.deliveryDate),
]);

export const task = pgTable('task', {
  id: uuid('id').primaryKey(),
  demandId: uuid('demand_id').notNull().references(() => demand.id, { onDelete: 'cascade' }),
  assignedToUserId: text('assigned_to_user_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  priority: text('priority').notNull().default('normal'),
  deliveryDate: date('delivery_date').notNull(),
  status: text('status').notNull().default('blocked'),
  acceptedAt: time('accepted_at'),
  readyAt: time('ready_at'),
  startedAt: time('started_at'),
  completedAt: time('completed_at'),
  pauseRequestedAt: time('pause_requested_at'),
  pauseReason: text('pause_reason'),
  pausedAt: time('paused_at'),
  deliveryNotes: text('delivery_notes'),
  previewUrl: text('preview_url'),
  version: integer('version').notNull().default(1),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [
  index('task_demand_id_idx').on(table.demandId),
  index('task_assigned_to_user_id_idx').on(table.assignedToUserId),
  index('task_status_idx').on(table.status),
  index('task_delivery_date_idx').on(table.deliveryDate),
  index('task_assigned_status_delivery_idx').on(table.assignedToUserId, table.status, table.deliveryDate),
  index('task_assigned_demand_idx').on(table.assignedToUserId, table.demandId),
  index('task_active_status_idx').on(table.demandId, table.status),
]);

export const taskRequirement = pgTable('task_requirement', {
  id: uuid('id').primaryKey(),
  taskId: uuid('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  mandatory: boolean('mandatory').notNull().default(true),
  satisfied: boolean('satisfied').notNull().default(false),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [
  index('task_requirement_task_id_idx').on(table.taskId),
]);

export const taskDependency = pgTable('task_dependency', {
  taskId: uuid('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
  dependsOnTaskId: uuid('depends_on_task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
  createdAt: time('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
  index('task_dependency_depends_on_task_id_idx').on(table.dependsOnTaskId),
]);

export const taskComment = pgTable('task_comment', {
  id: uuid('id').primaryKey(),
  taskId: uuid('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id),
  authorName: text('author_name').notNull(),
  content: text('content').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
}, (table) => [
  index('task_comment_task_id_idx').on(table.taskId),
  index('task_comment_author_id_idx').on(table.authorId),
]);

export const demandEvent = pgTable('demand_event', {
  id: uuid('id').primaryKey(),
  demandId: uuid('demand_id').notNull().references(() => demand.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => task.id, { onDelete: 'set null' }),
  actorId: text('actor_id').notNull().references(() => user.id),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  reason: text('reason'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: time('created_at').notNull().defaultNow(),
}, (table) => [
  index('demand_event_demand_id_idx').on(table.demandId),
  index('demand_event_task_id_idx').on(table.taskId),
  index('demand_event_actor_id_idx').on(table.actorId),
  index('demand_event_created_at_idx').on(table.createdAt),
  index('demand_event_demand_created_idx').on(table.demandId, table.createdAt),
]);

export const material = pgTable('material', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').notNull().references(() => client.id, { onDelete: 'restrict' }),
  demandId: uuid('demand_id').references(() => demand.id, { onDelete: 'restrict' }),
  taskId: uuid('task_id').references(() => task.id, { onDelete: 'restrict' }),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull(),
  url: text('url').notNull(),
  archivedAt: time('archived_at'),
  version: integer('version').notNull().default(1),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [
  index('material_client_id_idx').on(table.clientId),
  index('material_demand_id_idx').on(table.demandId),
  index('material_task_id_idx').on(table.taskId),
  index('material_created_by_user_id_idx').on(table.createdByUserId),
  index('material_category_idx').on(table.category),
  index('material_archived_at_idx').on(table.archivedAt),
  index('material_updated_at_idx').on(table.updatedAt),
  index('material_created_at_idx').on(table.createdAt),
]);

export const materialEvent = pgTable('material_event', {
  id: uuid('id').primaryKey(),
  materialId: uuid('material_id').notNull().references(() => material.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => user.id, { onDelete: 'restrict' }),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  reason: text('reason'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: time('created_at').notNull().defaultNow(),
}, (table) => [
  index('material_event_material_id_idx').on(table.materialId),
  index('material_event_actor_id_idx').on(table.actorId),
  index('material_event_created_at_idx').on(table.createdAt),
]);

// Fase 6 — auditoria de identidade (0004). IDs históricos sem FK para auth_user:
// remoção de conta não apaga evidência; expiração via public.prune_identity_events().
export const identityEvent = pgTable('identity_event', {
  id: uuid('id').primaryKey(),
  createdAt: time('created_at').notNull().defaultNow(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetUserId: text('target_user_id'),
  targetRoleId: text('target_role_id').references(() => role.id, { onDelete: 'restrict' }),
  previousRole: text('previous_role').references(() => role.id, { onDelete: 'restrict' }),
  newRole: text('new_role').references(() => role.id, { onDelete: 'restrict' }),
  previousActive: boolean('previous_active'),
  newActive: boolean('new_active'),
  previousPermissions: text('previous_permissions').array(),
  newPermissions: text('new_permissions').array(),
  revokedCount: integer('revoked_count').notNull().default(0),
}, (table) => [
  index('identity_event_created_at_id_idx').on(table.createdAt, table.id),
  index('identity_event_target_user_created_at_idx').on(table.targetUserId, table.createdAt, table.id),
]);

export const identityEventSubject = pgTable('identity_event_subject', {
  eventId: uuid('event_id').notNull().references(() => identityEvent.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
}, (table) => [
  primaryKey({ name: 'identity_event_subject_pkey', columns: [table.eventId, table.userId] }),
  index('identity_event_subject_user_event_idx').on(table.userId, table.eventId),
]);

export const notification = pgTable('notification', {
  id: uuid('id').primaryKey(),
  recipientUserId: text('recipient_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  demandId: uuid('demand_id').notNull().references(() => demand.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => task.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  sourceEventId: uuid('source_event_id').references(() => demandEvent.id, { onDelete: 'cascade' }),
  sourceDeliveryDate: date('source_delivery_date'),
  createdAt: time('created_at').notNull(),
  readAt: time('read_at'),
}, (table) => [
  uniqueIndex('notification_event_dedup_idx').on(table.recipientUserId, table.kind, table.sourceEventId),
  uniqueIndex('notification_calendar_task_dedup_idx').on(table.recipientUserId, table.kind, table.demandId, table.taskId, table.sourceDeliveryDate),
  uniqueIndex('notification_calendar_demand_dedup_idx').on(table.recipientUserId, table.kind, table.demandId, table.sourceDeliveryDate),
  index('notification_recipient_created_at_idx').on(table.recipientUserId, table.createdAt, table.id),
  index('notification_recipient_unread_idx').on(table.recipientUserId),
  index('notification_demand_id_idx').on(table.demandId),
  index('notification_task_id_idx').on(table.taskId),
  index('notification_source_event_id_idx').on(table.sourceEventId),
]);

export const demandTemplate = pgTable('demand_template', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('general'),
  defaultPriority: text('default_priority').notNull().default('normal'),
  estimatedDays: integer('estimated_days').notNull().default(5),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: time('created_at').notNull().defaultNow(),
  updatedAt: time('updated_at').notNull().defaultNow(),
}, (table) => [
  index('demand_template_active_idx').on(table.active),
  index('demand_template_category_idx').on(table.category),
]);

export const demandTemplateTask = pgTable('demand_template_task', {
  id: uuid('id').primaryKey(),
  templateId: uuid('template_id').notNull().references(() => demandTemplate.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  suggestedRole: text('suggested_role').notNull().default('collaborator'),
  priority: text('priority').notNull().default('normal'),
  dayOffsetStart: integer('day_offset_start').notNull().default(0),
  durationDays: integer('duration_days').notNull().default(1),
  orderIndex: integer('order_index').notNull().default(0),
}, (table) => [
  index('demand_template_task_template_id_idx').on(table.templateId),
]);

export const demandTemplateTaskRequirement = pgTable('demand_template_task_requirement', {
  id: uuid('id').primaryKey(),
  templateTaskId: uuid('template_task_id').notNull().references(() => demandTemplateTask.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  mandatory: boolean('mandatory').notNull().default(true),
  orderIndex: integer('order_index').notNull().default(0),
}, (table) => [
  index('demand_template_task_req_task_id_idx').on(table.templateTaskId),
]);

export const demandTemplateTaskDependency = pgTable('demand_template_task_dependency', {
  templateTaskId: uuid('template_task_id').notNull().references(() => demandTemplateTask.id, { onDelete: 'cascade' }),
  dependsOnTemplateTaskId: uuid('depends_on_template_task_id').notNull().references(() => demandTemplateTask.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.templateTaskId, table.dependsOnTemplateTaskId] }),
  index('demand_template_task_dep_depends_idx').on(table.dependsOnTemplateTaskId),
]);


