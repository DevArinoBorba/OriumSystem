import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardItem, DashboardResponse, Demand, SessionResponse } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { showToast } from './Toasts.js';
import { formatCalendarDate, queueWait, relativeDeadline } from '../dates.js';
import type { DashboardSectionKey } from '../types.js';

interface DashboardViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  onOpenItem: (target: { demandId: string; taskId?: string }) => void;
}

const DAY_LIMIT = 20;

const taskStatusLabels: Record<string, string> = {
  blocked: 'Aguardando',
  ready: 'Pronta',
  in_production: 'Em andamento',
  in_review: 'Em análise',
  changes_requested: 'Ajustes pedidos',
  paused: 'Pausada',
  completed: 'Concluído',
};

const priorityLabels: Record<string, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

const formatDate = formatCalendarDate;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Espera na fila só faz sentido para tarefa pronta e ainda não iniciada. */
function queueWaitFor(item: DashboardItem, today: string) {
  if (item.kind !== 'task' || item.status !== 'ready' || item.startedAt || !item.readyAt) return null;
  return queueWait(item.readyAt, today);
}

/** Atualização automática silenciosa enquanto a aba está visível. */
const AUTO_REFRESH_MS = 120_000;

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba' });
  const time = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Cuiaba',
  });
  return `${day} às ${time} (horário de Cuiabá)`;
}

function statusLabelFor(item: DashboardItem): string {
  if (item.kind === 'demand') {
    return item.status === 'completed' ? 'Concluído' : 'Aberto';
  }
  return taskStatusLabels[item.status] ?? item.status;
}

type SectionMeta = {
  key: DashboardSectionKey;
  title: string;
  description: string;
  headline: string;
  kindNote?: boolean;
};

const topSections: SectionMeta[] = [
  {
    key: 'production',
    title: 'Em produção',
    description: 'Demandas em andamento na operação.',
    headline: 'Demanda',
  },
  {
    key: 'awaitingAction',
    title: 'Dependendo de ação',
    description: 'Demandas aguardando revisão, aprovação, material, retorno ou decisão.',
    headline: 'Ação pendente',
  },
];

const pendingSections: SectionMeta[] = [
  {
    key: 'overdueTasks',
    title: 'Atrasadas na operação',
    description: 'Demandas atrasadas no prazo operacional.',
    headline: 'Atraso operacional',
  },
  {
    key: 'overdueDemands',
    title: 'Demandas com prazo vencido',
    description: 'Demandas abertas cujo prazo de entrega já passou.',
    headline: 'Prazo vencido',
  },
  {
    key: 'dueToday',
    title: 'Vencem hoje',
    description: 'Entregas previstas para o dia de hoje.',
    headline: 'Vence hoje',
  },
  {
    key: 'upcoming',
    title: 'Próximos 3 dias',
    description: 'De amanhã até os próximos três dias.',
    headline: 'Entrega próxima',
  },
  {
    key: 'urgent',
    title: 'Urgentes',
    description: 'Demandas de prioridade urgente em aberto.',
    headline: 'Urgente',
  },
];

type DashboardViewMode = 'list' | 'kanban';

type KanbanQuickFilter = 'all' | 'mine' | 'overdue' | 'dueToday' | 'urgent';

type KanbanColumnKey = 'tasks' | 'in_production' | 'in_review' | 'completed';

interface KanbanColumnMeta {
  key: KanbanColumnKey;
  title: string;
  subtitle: string;
  accentClass: string;
}

const kanbanColumns: KanbanColumnMeta[] = [
  {
    key: 'tasks',
    title: 'Demandas',
    subtitle: 'Tudo o que está em aberto',
    accentClass: 'col-tasks',
  },
  {
    key: 'in_production',
    title: 'Em andamento',
    subtitle: 'O que está produzindo',
    accentClass: 'col-progress',
  },
  {
    key: 'in_review',
    title: 'Em análise',
    subtitle: 'Em revisão ou aguardando aprovação',
    accentClass: 'col-analysis',
  },
  {
    key: 'completed',
    title: 'Concluído',
    subtitle: 'Entregas aprovadas e finalizadas',
    accentClass: 'col-completed',
  },
];

function isAwaitingApproval(item: DashboardItem): boolean {
  if (item.status === 'in_review') return true;
  if (!item.reason) return false;
  const r = item.reason.toLowerCase();
  return (
    r.includes('solicitação de pausa pendente') ||
    r.includes('aguardando avaliação') ||
    r.includes('aguardando aprovação')
  );
}

function classifyKanbanColumn(item: DashboardItem): KanbanColumnKey {
  if (item.status === 'completed') {
    return 'completed';
  }
  if (isAwaitingApproval(item)) {
    return 'in_review';
  }
  if (item.status === 'in_production') {
    return 'in_production';
  }
  return 'tasks';
}

function getInitialDashboardViewMode(): DashboardViewMode {
  if (typeof window === 'undefined') return 'kanban';
  try {
    const saved = localStorage.getItem('orium-dashboard-view-v2');
    if (saved === 'list' || saved === 'kanban') return saved;
    return 'kanban';
  } catch {
    return 'kanban';
  }
}

export function DashboardView({ session, onUnauthorized, onOpenItem }: DashboardViewProps) {
  const isAdmin = session.roles.includes('administrator');
  const hasUsersRead = session.permissions.includes('users.read');
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [extraTasks, setExtraTasks] = useState<DashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DashboardViewMode>(getInitialDashboardViewMode);
  const [kanbanSearch, setKanbanSearch] = useState('');
  const [kanbanAssigneeFilter, setKanbanAssigneeFilter] = useState<string>('all');
  const [kanbanPriorityFilter, setKanbanPriorityFilter] = useState<string>('all');
  const [kanbanQuickFilter, setKanbanQuickFilter] = useState<KanbanQuickFilter>('all');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumnKey | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [columnOverrides, setColumnOverrides] = useState<Record<string, KanbanColumnKey>>({});
  const dragSuppressClickRef = useRef(false);
  const hasDataRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);

  const handleSelectViewMode = (mode: DashboardViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('orium-dashboard-view-v2', mode);
    } catch {
      // Ignore storage error
    }
  };

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setError(null);
      }
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const response = await api.getDashboard({ limit: DAY_LIMIT }, controller.signal, onUnauthorized);
        if (requestRef.current === controller && !controller.signal.aborted) {
          setData(response);
          setUpdatedAt(response.generatedAt);
          hasDataRef.current = true;
          setError(null);
        }

        // Carrega todas as tarefas (incluindo concluídas e solicitações de aprovação) em paralelo para o Kanban
        void (async () => {
          try {
            const [demandsRes, usersRes] = await Promise.all([
              api.listDemands({ status: 'all', page: 1, pageSize: 30 }, controller.signal, onUnauthorized),
              hasUsersRead
                ? api.listUsers(controller.signal, onUnauthorized).catch(() => ({ users: [] }))
                : Promise.resolve({ users: [] }),
            ]);
            if (controller.signal.aborted) return;

            const userNames = new Map<string, string>();
            for (const w of response.workload) {
              userNames.set(w.userId, w.name);
            }
            for (const u of usersRes.users) {
              userNames.set(u.id, u.name);
            }
            if (session.user?.id && session.user?.name) {
              userNames.set(session.user.id, session.user.name);
            }

            const details = await Promise.all(
              demandsRes.demands.slice(0, 25).map((d: Demand) =>
                api
                  .getDemand(d.id, controller.signal, onUnauthorized)
                  .then((res) => ({ demand: res.demand, tasks: res.tasks }))
                  .catch(() => null),
              ),
            );
            if (controller.signal.aborted || requestRef.current !== controller) return;

            const fetchedItems: DashboardItem[] = [];
            for (const entry of details) {
              if (!entry) continue;
              const { demand } = entry;
              let { tasks } = entry;
              if (tasks.length === 0 && session.permissions.includes('tasks.manage') && demand.status === 'open') {
                try {
                  const createdTaskRes = await api.createTask(
                    {
                      demandId: demand.id,
                      assignedToUserId: session.user.id,
                      title: demand.title,
                      description: demand.description,
                      priority: demand.priority,
                      deliveryDate: demand.deliveryDate,
                      requirements: [],
                      dependsOnTaskIds: [],
                    },
                    controller.signal,
                    onUnauthorized,
                  );
                  tasks = [createdTaskRes.task];
                } catch {
                  // Segue sem falha
                }
              }
              for (const t of tasks) {
                const assigneeName = userNames.get(t.assignedToUserId);
                const pausePendingReason = t.pauseRequestedAt
                  ? t.pauseReason
                    ? `Solicitação de pausa pendente: ${t.pauseReason}`
                    : 'Solicitação de pausa pendente de aprovação'
                  : null;
                fetchedItems.push({
                  kind: 'task',
                  id: t.id,
                  title: t.title,
                  demandId: demand.id,
                  demandTitle: demand.title,
                  client: {
                    id: demand.client.id,
                    name: demand.client.name,
                  },
                  status: t.status,
                  priority: t.priority,
                  deliveryDate: t.deliveryDate,
                  taskId: t.id,
                  startedAt: t.startedAt,
                  readyAt: t.readyAt,
                  reason: pausePendingReason,
                  assignedTo: assigneeName
                    ? { id: t.assignedToUserId, name: assigneeName }
                    : t.assignedToUserId === session.user.id
                      ? { id: session.user.id, name: session.user.name }
                      : null,
                });
              }
            }
            setExtraTasks(fetchedItems);
            setColumnOverrides({});
          } catch {
            // Falha secundária silenciosa; mantém itens principais do dashboard
          }
        })();
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        if (requestRef.current === controller) {
          if (err instanceof ApiError && err.status === 403) {
            setData(null);
            setUpdatedAt(null);
            hasDataRef.current = false;
            setError('Acesso ao Painel foi revogado. Atualize a página ou fale com um administrador.');
          } else if (hasDataRef.current) {
            setError('Não foi possível atualizar o Painel. Mostrando os dados da última atualização.');
          } else {
            setError('Não foi possível carregar o Painel. Tente novamente.');
          }
        }
      } finally {
        if (requestRef.current === controller) {
          setLoading(false);
          setRefreshing(false);
          requestRef.current = null;
        }
      }
    },
    [hasUsersRead, onUnauthorized, session.permissions, session.user.id, session.user.name],
  );

  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
    };
  }, [load]);

  // Mantém o Painel atual sem clique: a cada 2 min com a aba visível e ao voltar para ela.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible' && hasDataRef.current && !requestRef.current) {
        void load(true);
      }
    };
    const interval = window.setInterval(refreshIfVisible, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  const handleOpen = (item: DashboardItem) => {
    if (dragSuppressClickRef.current) return;
    if (item.kind === 'task') {
      onOpenItem({ demandId: item.demandId, taskId: item.taskId ?? item.id });
    } else {
      onOpenItem({ demandId: item.demandId });
    }
  };

  const handleDropTask = async (taskId: string, targetColumn: KanbanColumnKey, currentColumn: KanbanColumnKey) => {
    setDragOverColumn(null);
    setDraggingTaskId(null);
    if (!taskId || targetColumn === currentColumn || movingTaskId === taskId) return;

    const columnTitles: Record<KanbanColumnKey, string> = {
      tasks: 'Demandas',
      in_production: 'Em andamento',
      in_review: 'Em análise',
      completed: 'Concluído',
    };

    const effectiveColumn: KanbanColumnKey =
      targetColumn === 'completed' && !isAdmin ? 'in_review' : targetColumn;

    setColumnOverrides((prev) => ({ ...prev, [taskId]: effectiveColumn }));
    setMovingTaskId(taskId);

    const controller = new AbortController();
    try {
      await api.moveTaskKanban(taskId, { column: effectiveColumn }, controller.signal, onUnauthorized);
      if (targetColumn === 'completed' && !isAdmin) {
        showToast('Tarefa enviada para "Em análise" (aprovação do administrador).');
      } else {
        showToast(`Tarefa movida para "${columnTitles[effectiveColumn]}".`);
      }
      void load(true);
    } catch (err) {
      setColumnOverrides((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      if (err instanceof ApiError) {
        if (err.code === 'MANDATORY_REQUIREMENTS_UNSATISFIED') {
          showToast('Não é possível iniciar: há requisitos obrigatórios pendentes nesta tarefa.');
        } else if (err.code === 'DEPENDENCIES_UNCOMPLETED') {
          showToast('Não é possível iniciar: há tarefas dependentes ainda não concluídas.');
        } else if (err.status === 403) {
          showToast('Você só pode mover tarefas atribuídas a você.');
        } else {
          showToast('Não foi possível mover a tarefa. Tente novamente.');
        }
      } else {
        showToast('Não foi possível mover a tarefa. Tente novamente.');
      }
    } finally {
      setMovingTaskId(null);
    }
  };

  const showWorkload = isAdmin && hasUsersRead && data?.workloadAvailable === true;

  const renderItem = (item: DashboardItem) => (
    <li
      key={item.id}
      className="dashboard-item"
      onClick={() => handleOpen(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen(item);
        }
      }}
      aria-label={`Abrir ${item.kind === 'task' ? 'tarefa' : 'chamado'} ${item.title}`}
    >
      <div className="dashboard-item-main">
        <div className="dashboard-item-title">
          <span className={`dashboard-kind ${item.kind}`}>{item.kind === 'task' ? 'Tarefa' : 'Chamado'}</span>
          <span className="dashboard-title-text">{item.title}</span>
          <span className={`priority-badge ${item.priority}`}>{priorityLabels[item.priority] ?? item.priority}</span>
        </div>
        <div className="dashboard-item-meta">
          {item.demandTitle && <span className="muted-dash">Chamado: <strong>{item.demandTitle}</strong></span>}
          <span>Cliente: <strong>{item.client.name}</strong></span>
          <span>
            Entrega: <strong>{formatDate(item.deliveryDate)}</strong>
            {(() => {
              const rel = data && item.status !== 'completed' ? relativeDeadline(item.deliveryDate, data.today) : null;
              return rel ? <span className={`deadline-chip ${rel.tone}`}>{rel.label}</span> : null;
            })()}
          </span>
          {item.status && <span className={`status-badge ${item.status === 'completed' ? 'complete' : 'open'}`}>{statusLabelFor(item)}</span>}
          {item.kind === 'task' && item.assignedTo ? (
            <span>Responsável: <strong>{item.assignedTo.name}</strong></span>
          ) : null}
          {(() => {
            const wait = data ? queueWaitFor(item, data.today) : null;
            return wait ? <span className={`queue-chip ${wait.stale ? 'stale' : ''}`}>{wait.label}</span> : null;
          })()}
        </div>
        {item.reason && <p className="dashboard-item-reason">{item.reason}</p>}
      </div>
      <span className="action-btn edit dashboard-open-btn" aria-hidden="true">
        <span>{item.kind === 'task' ? 'Abrir tarefa' : 'Abrir chamado'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </li>
  );

  const renderSection = (meta: SectionMeta) => {
    const section = data?.sections[meta.key];
    if (!section) return null;
    const shown = section.items.length;
    const truncated = section.total > shown;
    return (
      <section className="dashboard-section" aria-labelledby={`section-${meta.key}-heading`}>
        <div className="section-heading-row">
          <div>
            <h2 className="section-heading" id={`section-${meta.key}-heading`}>{meta.title}</h2>
            <p className="muted-text">{meta.description}</p>
          </div>
          <span className="dashboard-count">
            {section.total} {section.total === 1 ? 'item' : 'itens'}
            {truncated && <span className="dashboard-limit-note"> · exibindo {shown} de {section.total}</span>}
          </span>
        </div>
        {section.items.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <p className="empty-title">Nada por aqui no momento.</p>
            <p className="empty-description">{meta.title} sem itens.</p>
          </div>
        ) : (
          <ul className="dashboard-item-list">
            {section.items.map(renderItem)}
          </ul>
        )}
      </section>
    );
  };

  const renderWorkload = () => {
    if (!showWorkload || !data) return null;
    return (
      <section className="dashboard-section" aria-labelledby="section-workload-heading">
        <div className="section-heading-row">
          <div>
            <h2 className="section-heading" id="section-workload-heading">Carga da equipe</h2>
            <p className="muted-text">Volume de trabalho atual por pessoa.</p>
          </div>
        </div>
        {data.workload.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <p className="empty-title">Sem dados de carga.</p>
            <p className="empty-description">Não há cargas para exibir no momento.</p>
          </div>
        ) : (
          <div className="workload-table-wrap">
            <table className="workload-table">
              <thead>
                <tr>
                  <th scope="col">Pessoa</th>
                  <th scope="col" className="text-right">Em produção</th>
                  <th scope="col" className="text-right">Dependendo de ação</th>
                  <th scope="col" className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.workload.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      {row.name}
                      {!row.active && <span className="muted-dash"> · inativa(o)</span>}
                    </td>
                    <td className="text-right">{row.production}</td>
                    <td className="text-right">{row.awaitingAction}</td>
                    <td className="text-right"><strong>{row.total}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const renderKanbanBoard = () => {
    if (!data) return null;

    // Consolidar tarefas únicas de todas as seções do Painel + tarefas extras (incluindo Concluído)
    const tasksById = new Map<string, DashboardItem>();
    const allSectionKeys: DashboardSectionKey[] = [
      'awaitingAction',
      'production',
      'overdueTasks',
      'dueToday',
      'upcoming',
      'urgent',
    ];

    for (const key of allSectionKeys) {
      const items = data.sections[key]?.items ?? [];
      for (const item of items) {
        if (item.kind !== 'task') continue;
        const existing = tasksById.get(item.id);
        if (!existing) {
          tasksById.set(item.id, item);
        } else if (!existing.reason && item.reason) {
          tasksById.set(item.id, { ...existing, reason: item.reason });
        }
      }
    }

    for (const item of extraTasks) {
      if (item.kind !== 'task') continue;
      const existing = tasksById.get(item.id);
      if (!existing) {
        tasksById.set(item.id, item);
      } else {
        tasksById.set(item.id, {
          ...existing,
          reason: existing.reason ?? item.reason,
          assignedTo: existing.assignedTo ?? item.assignedTo,
        });
      }
    }

    const allTasks = Array.from(tasksById.values());

    // Extrair lista única de responsáveis presentes ou do workload
    const assigneeMap = new Map<string, string>();
    for (const w of data.workload) {
      assigneeMap.set(w.userId, w.name);
    }
    for (const t of allTasks) {
      if (t.assignedTo) {
        assigneeMap.set(t.assignedTo.id, t.assignedTo.name);
      }
    }
    const assignees = Array.from(assigneeMap.entries()).map(([id, name]) => ({ id, name }));

    const overdueSet = new Set((data.sections.overdueTasks?.items ?? []).map((i) => i.id));
    const dueTodaySet = new Set((data.sections.dueToday?.items ?? []).map((i) => i.id));
    const overdueDemands = data.sections.overdueDemands?.items ?? [];

    const isTaskOverdue = (t: DashboardItem) =>
      t.status !== 'completed' && (overdueSet.has(t.id) || t.deliveryDate < data.today);
    const isTaskDueToday = (t: DashboardItem) =>
      t.status !== 'completed' && (dueTodaySet.has(t.id) || t.deliveryDate === data.today);

    const myTasksCount = allTasks.filter((t) => t.assignedTo?.id === session.user.id).length;
    const overdueCount = allTasks.filter(isTaskOverdue).length;
    const dueTodayCount = allTasks.filter(isTaskDueToday).length;
    const urgentCount = allTasks.filter((t) => t.status !== 'completed' && t.priority === 'urgent').length;

    const normalizedQuery = kanbanSearch.trim().toLowerCase();

    const filteredTasks = allTasks.filter((task) => {
      const isOverdue = isTaskOverdue(task);
      const isDueToday = isTaskDueToday(task);

      // Filtro Rápido ativo
      if (kanbanQuickFilter === 'mine' && task.assignedTo?.id !== session.user.id) {
        return false;
      }
      if (kanbanQuickFilter === 'overdue' && !isOverdue) {
        return false;
      }
      if (kanbanQuickFilter === 'dueToday' && !isDueToday) {
        return false;
      }
      if (kanbanQuickFilter === 'urgent' && (task.status === 'completed' || task.priority !== 'urgent')) {
        return false;
      }

      // Filtros específicos
      if (kanbanPriorityFilter !== 'all' && task.priority !== kanbanPriorityFilter) {
        return false;
      }
      if (kanbanAssigneeFilter !== 'all' && task.assignedTo?.id !== kanbanAssigneeFilter) {
        return false;
      }
      if (normalizedQuery) {
        const haystack = `${task.title} ${task.demandTitle ?? ''} ${task.client.name} ${task.assignedTo?.name ?? ''}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });

    const isFiltered =
      Boolean(kanbanSearch) ||
      kanbanAssigneeFilter !== 'all' ||
      kanbanPriorityFilter !== 'all' ||
      kanbanQuickFilter !== 'all';

    return (
      <div className="dashboard-kanban-wrapper" aria-label="Quadro Kanban Operacional">
        {/* Barra de resumo rápida e filtros interativos do Kanban */}
        <div className="kanban-controls-bar">
          <div className="kanban-quick-row">
            <div className="kanban-quick-filters" role="group" aria-label="Filtros rápidos do Kanban">
              <button
                type="button"
                className={`kanban-quick-pill ${kanbanQuickFilter === 'all' ? 'active' : ''}`}
                onClick={() => setKanbanQuickFilter('all')}
                title="Mostrar todas as tarefas"
              >
                <span>Todas</span>
                <span className="quick-pill-badge">{allTasks.length}</span>
              </button>

              {session.user?.id && (
                <button
                  type="button"
                  className={`kanban-quick-pill ${kanbanQuickFilter === 'mine' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'mine' ? 'all' : 'mine'))}
                  title="Ver apenas demandas atribuídas a você"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>Minhas demandas</span>
                  <span className="quick-pill-badge">{myTasksCount}</span>
                </button>
              )}

              {overdueCount > 0 && (
                <button
                  type="button"
                  className={`kanban-quick-pill pill-danger ${kanbanQuickFilter === 'overdue' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'overdue' ? 'all' : 'overdue'))}
                  title="Filtrar demandas atrasadas"
                >
                  <span className="quick-pill-dot danger" aria-hidden="true" />
                  <span>Atrasadas</span>
                  <span className="quick-pill-badge danger">{overdueCount}</span>
                </button>
              )}

              {dueTodayCount > 0 && (
                <button
                  type="button"
                  className={`kanban-quick-pill pill-warning ${kanbanQuickFilter === 'dueToday' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'dueToday' ? 'all' : 'dueToday'))}
                  title="Filtrar demandas que vencem hoje"
                >
                  <span className="quick-pill-dot warning" aria-hidden="true" />
                  <span>Vencem hoje</span>
                  <span className="quick-pill-badge warning">{dueTodayCount}</span>
                </button>
              )}

              {urgentCount > 0 && (
                <button
                  type="button"
                  className={`kanban-quick-pill pill-urgent ${kanbanQuickFilter === 'urgent' ? 'active' : ''}`}
                  onClick={() => setKanbanQuickFilter((curr) => (curr === 'urgent' ? 'all' : 'urgent'))}
                  title="Filtrar demandas com prioridade urgente"
                >
                  <span className="quick-pill-dot urgent" aria-hidden="true" />
                  <span>Urgentes</span>
                  <span className="quick-pill-badge urgent">{urgentCount}</span>
                </button>
              )}
            </div>

            <div className="kanban-stat-counter">
              <span>
                Exibindo <strong>{filteredTasks.length}</strong> de <strong>{allTasks.length}</strong> demandas
              </span>
            </div>
          </div>

          <div className="kanban-filter-row">
            <div className="kanban-search-box">
              <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="kanban-search-input"
                placeholder="Buscar demanda, cliente, responsável…"
                aria-label="Buscar cartões do Kanban"
                value={kanbanSearch}
                onChange={(e) => setKanbanSearch(e.target.value)}
              />
              {kanbanSearch && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setKanbanSearch('')}
                  aria-label="Limpar texto da busca"
                  title="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>

            {isAdmin && assignees.length > 0 && (
              <select
                className="kanban-filter-select"
                aria-label="Filtrar por responsável"
                value={kanbanAssigneeFilter}
                onChange={(e) => setKanbanAssigneeFilter(e.target.value)}
              >
                <option value="all">Todos os responsáveis</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}

            <select
              className="kanban-filter-select"
              aria-label="Filtrar por prioridade"
              value={kanbanPriorityFilter}
              onChange={(e) => setKanbanPriorityFilter(e.target.value)}
            >
              <option value="all">Todas as prioridades</option>
              <option value="urgent">Urgente</option>
              <option value="high">Alta</option>
              <option value="normal">Normal</option>
              <option value="low">Baixa</option>
            </select>

            {isFiltered && (
              <button
                type="button"
                className="kanban-clear-filters-btn"
                onClick={() => {
                  setKanbanSearch('');
                  setKanbanAssigneeFilter('all');
                  setKanbanPriorityFilter('all');
                  setKanbanQuickFilter('all');
                }}
                title="Limpar todos os filtros aplicados"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span>Limpar filtros</span>
              </button>
            )}
          </div>
        </div>

        {/* Alerta de chamados com prazo vencido se houver */}
        {overdueDemands.length > 0 && (
          <div className="kanban-overdue-demands-bar" role="region" aria-label="Chamados com prazo vencido">
            <div className="kanban-overdue-demands-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <strong>{data.sections.overdueDemands.total} chamado(s) com prazo de entrega vencido:</strong>
            </div>
            <div className="kanban-overdue-demands-list">
              {overdueDemands.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="kanban-overdue-demand-chip"
                  onClick={() => handleOpen(d)}
                >
                  <span className="chip-title">{d.title}</span>
                  <span className="chip-meta">{d.client.name} · {formatDate(d.deliveryDate)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Colunas do Quadro Kanban (Estilo Motion) */}
        <div className="kanban-board-grid">
          {kanbanColumns.map((col) => {
            const getEffectiveCol = (t: DashboardItem): KanbanColumnKey =>
              columnOverrides[t.id] ?? classifyKanbanColumn(t);

            const colItems = filteredTasks.filter((t) => getEffectiveCol(t) === col.key);
            const colOverdueCount = colItems.filter(isTaskOverdue).length;
            const isDropTarget = dragOverColumn === col.key;

            return (
              <section
                key={col.key}
                className={`kanban-column ${col.accentClass} ${isDropTarget ? 'is-drop-target' : ''}`}
                aria-labelledby={`kanban-col-${col.key}-title`}
                title={col.subtitle}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverColumn !== col.key) {
                    setDragOverColumn(col.key);
                  }
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOverColumn(col.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDragOverColumn((curr) => (curr === col.key ? null : curr));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const droppedTaskId = e.dataTransfer.getData('text/plain') || draggingTaskId;
                  if (!droppedTaskId) {
                    setDragOverColumn(null);
                    return;
                  }
                  const droppedTask = allTasks.find((t) => t.id === droppedTaskId);
                  const currentCol = droppedTask ? getEffectiveCol(droppedTask) : col.key;
                  void handleDropTask(droppedTaskId, col.key, currentCol);
                }}
              >
                <header className="kanban-column-header">
                  <div className="kanban-column-title-row">
                    <div className="kanban-column-title-group">
                      <span className={`kanban-motion-pill ${col.accentClass}`}>
                        <span className="kanban-motion-dot" aria-hidden="true" />
                        <h2 className="kanban-column-title" id={`kanban-col-${col.key}-title`}>
                          {col.title}
                        </h2>
                      </span>
                      <span className={`kanban-motion-count stat-value ${col.accentClass}`}>
                        {colItems.length}
                      </span>
                    </div>
                    {colOverdueCount > 0 && (
                      <div className="kanban-column-header-badges">
                        <span className="kanban-col-alert-tag" title={`${colOverdueCount} tarefa(s) atrasada(s)`}>
                          {colOverdueCount} atrasada{colOverdueCount > 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </header>

                <div className="kanban-column-body">
                  {colItems.length === 0 ? (
                    <div className="kanban-empty-slot">
                      <span className="kanban-empty-title">
                        {isDropTarget ? `Soltar em ${col.title}` : `Sem itens em ${col.title.toLowerCase()}`}
                      </span>
                      <span className="kanban-empty-desc">{col.subtitle}</span>
                    </div>
                  ) : (
                    <ul className="kanban-card-list">
                      {colItems.map((item) => {
                        const effectiveCol = getEffectiveCol(item);
                        const isCompleted = effectiveCol === 'completed';
                        const isOverdue = !isCompleted && isTaskOverdue(item);
                        const isDueToday = !isCompleted && isTaskDueToday(item);
                        const rel = !isCompleted ? relativeDeadline(item.deliveryDate, data.today) : null;
                        const isSoon = !isOverdue && !isDueToday && rel?.tone === 'soon';
                        const dateText = isCompleted
                          ? `Concluído · ${formatDate(item.deliveryDate)}`
                          : isOverdue
                            ? rel?.tone === 'overdue'
                              ? capitalize(rel.label)
                              : `Atrasada · ${formatDate(item.deliveryDate)}`
                            : isDueToday
                              ? 'Hoje'
                              : isSoon && rel
                                ? capitalize(rel.label)
                                : formatDate(item.deliveryDate);

                        const awaitingApproval = !isCompleted && effectiveCol === 'in_review';
                        const showSubStatus =
                          col.key === 'tasks' &&
                          (item.status === 'blocked' ||
                            item.status === 'paused' ||
                            item.status === 'changes_requested' ||
                            item.status === 'ready');
                        const isDragging = draggingTaskId === item.id;
                        const isMoving = movingTaskId === item.id;

                        return (
                          <li
                            key={item.id}
                            draggable
                            onDragStart={(e) => {
                              dragSuppressClickRef.current = true;
                              setDraggingTaskId(item.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', item.id);
                            }}
                            onDragEnd={() => {
                              setDraggingTaskId(null);
                              setDragOverColumn(null);
                              window.setTimeout(() => {
                                dragSuppressClickRef.current = false;
                              }, 120);
                            }}
                            className={`kanban-card ${isOverdue ? 'is-overdue' : ''} ${!isCompleted && item.priority === 'urgent' ? 'is-urgent' : ''} ${isCompleted ? 'is-completed' : ''} ${isDragging ? 'is-dragging' : ''} ${isMoving ? 'is-moving' : ''}`}
                            onClick={() => handleOpen(item)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleOpen(item);
                              }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Abrir detalhes da tarefa ${item.title} (arraste para mudar de coluna)`}
                          >
                            <h3 className="kanban-card-title">{item.title}</h3>

                            <div className="kanban-card-tags-row">
                              <span className="kanban-card-client" title={`Cliente: ${item.client.name}`}>
                                {item.client.name}
                              </span>

                              {item.demandTitle && item.demandTitle !== item.title && (
                                <span className="kanban-card-demand-tag" title={`Demanda: ${item.demandTitle}`}>
                                  {item.demandTitle}
                                </span>
                              )}

                              {!isCompleted && item.priority !== 'normal' && (
                                <span className={`priority-badge ${item.priority}`}>
                                  {priorityLabels[item.priority] ?? item.priority}
                                </span>
                              )}

                              {awaitingApproval && (
                                <span className="kanban-approval-chip" title={item.reason ?? 'Aguardando aprovação'}>
                                  {item.status === 'in_review' ? 'Aguardando aprovação' : 'Aprovar pausa'}
                                </span>
                              )}

                              {showSubStatus && (
                                <span className={`kanban-substatus-chip status-${item.status}`}>
                                  {taskStatusLabels[item.status] ?? item.status}
                                </span>
                              )}
                            </div>

                            {(() => {
                              const wait = !isCompleted ? queueWaitFor(item, data.today) : null;
                              return wait ? (
                                <span
                                  className={`queue-chip ${wait.stale ? 'stale' : ''}`}
                                  title="Tempo desde que os requisitos foram atendidos, sem início da produção"
                                >
                                  {wait.label}
                                </span>
                              ) : null;
                            })()}

                            {(() => {
                              const isBoilerplate =
                                item.reason === 'Pronta aguardando início da produção' ||
                                item.reason === 'Pronta aguardando aceite do responsável' ||
                                item.reason === 'Submetida para revisão (aguardando avaliação do administrador)' ||
                                item.reason === 'Bloqueada por requisitos ou dependências pendentes' ||
                                item.reason === 'Aguardando ação operacional';
                              if (!item.reason || isBoilerplate || isCompleted) return null;
                              return (
                                <div className="kanban-card-reason">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                  </svg>
                                  <span>{item.reason}</span>
                                </div>
                              );
                            })()}

                            <div className="kanban-card-footer">
                              <div className="kanban-card-meta">
                                {item.assignedTo ? (
                                  <span className="kanban-card-assignee" title={`Responsável: ${item.assignedTo.name}`}>
                                    <span className="assignee-avatar" aria-hidden="true">
                                      {item.assignedTo.name.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="assignee-name">{item.assignedTo.name.split(' ')[0]}</span>
                                  </span>
                                ) : (
                                  <span className="kanban-card-unassigned" title="Responsável da tarefa">
                                    Equipe
                                  </span>
                                )}

                                <span
                                  className={`kanban-card-date-badge ${
                                    isCompleted
                                      ? 'date-completed'
                                      : isOverdue
                                        ? 'date-overdue'
                                        : isDueToday
                                          ? 'date-today'
                                          : isSoon
                                            ? 'date-soon'
                                            : ''
                                  }`}
                                  title={`Entrega: ${formatDate(item.deliveryDate)}`}
                                >
                                  <span>{dateText}</span>
                                </span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {renderWorkload()}
      </div>
    );
  };

  const updatedAtLabel = updatedAt
    ? `${error && hasDataRef.current ? 'Dados da última atualização: ' : 'Atualizado '}${formatDateTime(updatedAt)}`
    : undefined;

  return (
    <section className="view-panel" aria-labelledby="dashboard-heading">
      <div className="panel-header">
        <div>
          <h1 id="dashboard-heading">Painel</h1>
          <p className="panel-subtitle">
            {data && data.scope === 'assigned'
              ? 'Visão das entregas atribuídas a você.'
              : 'Acompanhe as tarefas em aberto, em andamento, em análise e concluídas.'}
          </p>
        </div>
        <div className="dashboard-toolbar">
          {updatedAtLabel && <span className="dashboard-updated-at">{updatedAtLabel}</span>}
          <div className="dashboard-view-switcher" role="group" aria-label="Modo de visualização do Painel">
            <button
              type="button"
              className={`view-switch-btn ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => handleSelectViewMode('kanban')}
              aria-pressed={viewMode === 'kanban'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="5" height="18" rx="1" />
                <rect x="10" y="3" width="5" height="12" rx="1" />
                <rect x="17" y="3" width="5" height="15" rx="1" />
              </svg>
              <span>Kanban</span>
            </button>
            <button
              type="button"
              className={`view-switch-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => handleSelectViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <span>Lista</span>
            </button>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-banner error" role="alert" style={{ marginBottom: 16 }}>
          <span>{error}</span>
          <button
            type="button"
            className="primary-button small"
            onClick={() => void load(false)}
            disabled={loading}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="dashboard-skeleton" role="status" aria-live="polite">
          <span className="sr-only">Carregando o Painel…</span>
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      ) : data ? (
        viewMode === 'kanban' ? (
          renderKanbanBoard()
        ) : (
          <div className="dashboard-sections">
            {topSections.map(renderSection)}

            <section className="dashboard-section dashboard-section-pending" aria-labelledby="section-pending-heading">
              <div className="section-heading-row">
                <div>
                  <h2 className="section-heading" id="section-pending-heading">Pendências</h2>
                  <p className="muted-text">
                    Atrasos, vencimentos e urgências que pedem atenção.
                  </p>
                </div>
              </div>
              <div className="dashboard-pending-groups">
                {pendingSections.map(renderSection)}
              </div>
            </section>

            {renderWorkload()}
          </div>
        )
      ) : null}
    </section>
  );
}
