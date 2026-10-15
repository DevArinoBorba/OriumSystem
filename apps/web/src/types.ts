import type {
  BackupFileItem,
  BackupStatusResponse,
  BottlenecksReportResponse,
  Client,
  ClientTimelineEvent,
  ClientTimelineQuery,
  ClientTimelineResponse,
  CreateDemandTemplateInput,
  CreateMaterialInput,
  DashboardItem,
  DashboardItemClient,
  DashboardItemKind,
  DashboardItemUser,
  DashboardQuery,
  DashboardResponse,
  DashboardSection,
  DashboardWorkloadUser,
  Demand,
  DemandTemplate,
  InstantiateDemandTemplateInput,
  ListMaterialTargetsQuery,
  ListMaterialTargetsResponse,
  ListMaterialsQuery,
  ListMaterialsResponse,
  ListNotificationsQuery,
  Material,
  MaterialCategory,
  MaterialHistoryEvent,
  MaterialHistoryResponse,
  MaterialTarget,
  Notification,
  NotificationKind,
  NotificationListResponse,
  NotificationResponse,
  ProductivityReportResponse,
  Role,
  SessionResponse,
  Task,
  TimelineEventSource,
  TriggerBackupResponse,
  UpdateDemandTemplateInput,
  UpdateMaterialInput,
  UpdateProfileInput,
  ChangePasswordInput,
  ClientCredential,
  ClientCredentialCategory,
  ClientCredentialListResponse,
  ClientCredentialSecretResponse,
  CreateClientCredentialInput,
  UpdateClientCredentialInput,
  HermesStatusResponse,
} from '@orium/contracts';

export type ActiveTab =
  | 'dashboard'
  | 'mobile'
  | 'clients'
  | 'team'
  | 'demands'
  | 'materials'
  | 'notifications'
  | 'reports'
  | 'backups'
  | 'vault'
  | 'profile';

export type {
  BackupFileItem,
  BackupStatusResponse,
  BottlenecksReportResponse,
  ChangePasswordInput,
  Client,
  ClientCredential,
  ClientCredentialCategory,
  ClientCredentialListResponse,
  ClientCredentialSecretResponse,
  ClientTimelineEvent,
  ClientTimelineQuery,
  ClientTimelineResponse,
  CreateClientCredentialInput,
  CreateDemandTemplateInput,
  CreateMaterialInput,
  DashboardItem,
  DashboardItemClient,
  DashboardItemKind,
  DashboardItemUser,
  DashboardQuery,
  DashboardResponse,
  DashboardSection,
  DashboardWorkloadUser,
  Demand,
  DemandTemplate,
  HermesStatusResponse,
  InstantiateDemandTemplateInput,
  ListMaterialTargetsQuery,
  ListMaterialTargetsResponse,
  ListMaterialsQuery,
  ListMaterialsResponse,
  ListNotificationsQuery,
  Material,
  MaterialCategory,
  MaterialHistoryEvent,
  MaterialHistoryResponse,
  MaterialTarget,
  Notification,
  NotificationKind,
  NotificationListResponse,
  NotificationResponse,
  ProductivityReportResponse,
  Role,
  SessionResponse,
  Task,
  TimelineEventSource,
  TriggerBackupResponse,
  UpdateClientCredentialInput,
  UpdateDemandTemplateInput,
  UpdateMaterialInput,
  UpdateProfileInput,
};

export type DashboardScope = DashboardResponse['scope'];
export type DashboardSectionKey = keyof DashboardResponse['sections'];

export type UserListItem = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role: Role;
};

export type ClientsFilterStatus = 'active' | 'archived' | 'all';

export type ClientFormState = {
  id?: string;
  version?: number;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
};

export type ConfirmationModalState =
  | { type: 'archive-client'; client: Client }
  | { type: 'deactivate-user'; user: UserListItem }
  | null;

export type VersionConflictState = {
  client: Client;
  userEdits: ClientFormState;
} | null;

export type DemandsStatusFilter = 'open' | 'completed' | 'all';
export type DemandPriorityFilter = 'low' | 'normal' | 'high' | 'urgent' | 'all';

export type DemandFormState = {
  clientId: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  deliveryDate: string;
};

export type TaskFormState = {
  assignedToUserId: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  deliveryDate: string;
  requirements: { title: string; mandatory: boolean }[];
  dependsOnTaskIds: string[];
};

export type TaskReviewState = {
  decision: 'complete' | 'changes_requested';
  feedback: string;
};

export type MaterialsFilterCategory = 'all' | MaterialCategory;
export type MaterialsFilterStatus = 'active' | 'archived' | 'all';

export type MaterialNavigationTarget = {
  clientId?: string;
  demandId?: string;
  taskId?: string;
} | null;

export type MaterialFormState = {
  id?: string;
  version?: number;
  title: string;
  description: string;
  url: string;
  category: MaterialCategory;
  clientId: string;
  demandId: string;
  taskId: string;
};

export type MaterialVersionConflictState = {
  material: Material;
  userEdits: MaterialFormState;
} | null;

