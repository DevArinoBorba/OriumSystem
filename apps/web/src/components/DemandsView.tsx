import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  updateDemandSchema,
  type Client,
  type Demand,
  type DemandEvent,
  type SessionResponse,
  type Task,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { showToast } from './Toasts.js';
import { DeadlineDate } from './DeadlineDate.js';
import { CreateDemandModal } from './CreateDemandModal.js';
import { TaskDetailView } from './TaskDetailView.js';
import { UseTemplateModal } from './UseTemplateModal.js';
import { ManageTemplatesModal } from './ManageTemplatesModal.js';
import type {
  DemandFormState,
  DemandPriorityFilter,
  DemandsStatusFilter,
  UserListItem,
} from '../types.js';

interface DemandsViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  /** Chamado/tarefa indicados pelo endereço (/demandas/:id/tarefas/:taskId). */
  routeDemandId?: string | null;
  routeTaskId?: string | null;
  /** Informa a seleção atual para manter o endereço sincronizado. */
  onNavigate?: (demandId: string | null, taskId: string | null) => void;
  onOpenMaterials?: (target: { clientId?: string; demandId?: string; taskId?: string }) => void;
}

const emptyDemandForm = (): DemandFormState => ({
  clientId: '',
  title: '',
  description: '',
  priority: 'normal',
  deliveryDate: '',
});

const priorityLabels: Record<DemandPriorityFilter, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
  all: 'Todas',
};

export function DemandsView({
  session,
  onUnauthorized,
  routeDemandId = null,
  routeTaskId = null,
  onNavigate,
  onOpenMaterials,
}: DemandsViewProps) {
  const isAdmin = session.roles.includes('administrator');
  const hasDemandsWrite = session.permissions.includes('demands.write');
  const hasUsersRead = session.permissions.includes('users.read');
  const hasMaterialsRead = session.permissions.includes('materials.read');

  // ---------------- List state ----------------
  const [demands, setDemands] = useState<Demand[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [status, setStatus] = useState<DemandsStatusFilter>('all');
  const [priority, setPriority] = useState<DemandPriorityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ---------------- Support data (clients & users for admin) ----------------
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);

  // ---------------- Demand detail state ----------------
  const [selectedDemandId, setSelectedDemandId] = useState<string | null>(null);
  const [demand, setDemand] = useState<Demand | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ---------------- History state ----------------
  const [historyOpen, setHistoryOpen] = useState(false);
  const [events, setEvents] = useState<DemandEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // ---------------- Create demand form ----------------
  const [demandFormOpen, setDemandFormOpen] = useState(false);

  // ---------------- Edit demand form ----------------
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<DemandFormState>(emptyDemandForm);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editVersionConflict, setEditVersionConflict] = useState(false);
  const editSubmittingRef = useRef(false);
  const editTitleInputRef = useRef<HTMLInputElement>(null);

  // ---------------- Complete demand dialog ----------------
  const [completeConfirm, setCompleteConfirm] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const completeDialogRef = useRef<HTMLDialogElement>(null);
  const completeActionBusyRef = useRef(false);

  // ---------------- Delete demand confirmation ----------------
  const [deleteTarget, setDeleteTarget] = useState<Demand | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ---------------- Selected task detail (renders TaskDetailView) ----------------
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // ---------------- Templates modals state ----------------
  const [useTemplateOpen, setUseTemplateOpen] = useState(false);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);

  const listRequestRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ============ Support data loaders ============
  const loadClientsList = useCallback(async () => {
    if (!hasDemandsWrite) return;
    const controller = new AbortController();
    try {
      const response = await api.listClients(
        { status: 'active', page: 1, pageSize: 100 },
        controller.signal,
        onUnauthorized,
      );
      setClients(response.clients);
      setClientsLoaded(true);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      // Keep form usable without client options? Better to surface.
      setClientsLoaded(false);
    }
  }, [hasDemandsWrite, onUnauthorized]);

  const loadUsersList = useCallback(async () => {
    if (!hasUsersRead) return;
    const controller = new AbortController();
    try {
      const response = await api.listUsers(controller.signal, onUnauthorized);
      const ordered = [...response.users].sort((a, b) => a.name.localeCompare(b.name));
      setUsers(ordered);
      setUsersLoaded(true);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setUsersLoaded(false);
    }
  }, [hasUsersRead, onUnauthorized]);

  useEffect(() => {
    void loadClientsList();
    void loadUsersList();
  }, [loadClientsList, loadUsersList]);

  // ============ List loader ============
  const loadDemands = useCallback(
    async (currentPage: number, currentStatus: DemandsStatusFilter, currentPriority: DemandPriorityFilter, q: string) => {
      listRequestRef.current?.abort();
      const controller = new AbortController();
      listRequestRef.current = controller;

      setLoading(true);
      setListError(null);

      try {
        const response = await api.listDemands(
          {
            q: q.trim() || undefined,
            status: currentStatus,
            priority: currentPriority,
            page: currentPage,
            pageSize,
          },
          controller.signal,
          onUnauthorized,
        );
        if (listRequestRef.current === controller && !controller.signal.aborted) {
          setDemands(response.demands);
          setTotal(response.total);
          if (response.demands.length === 0 && currentPage > 1) {
            setPage((prev) => Math.max(1, prev - 1));
          }
        }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (listRequestRef.current === controller) {
          if (error instanceof ApiError && error.status === 403) {
            setListError('Você não tem permissão para visualizar demandas.');
          } else {
            setListError('Não foi possível carregar a lista de demandas. Tente novamente.');
          }
        }
      } finally {
        if (listRequestRef.current === controller) {
          setLoading(false);
          listRequestRef.current = null;
        }
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void loadDemands(page, status, priority, appliedSearch);
    return () => {
      listRequestRef.current?.abort();
    };
  }, [page, status, priority, appliedSearch, loadDemands]);

  // Busca enquanto digita (com atraso curto); Enter continua aplicando na hora.
  useEffect(() => {
    if (searchQuery === appliedSearch) return;
    const timer = window.setTimeout(() => {
      setPage(1);
      setAppliedSearch(searchQuery);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchQuery, appliedSearch]);

  // ============ Detail loader ============
  const loadDemandDetail = useCallback(
    async (id: string, refreshInPlace = false) => {
      detailRequestRef.current?.abort();
      const controller = new AbortController();
      detailRequestRef.current = controller;
      if (!refreshInPlace) {
        setDetailLoading(true);
      }
      setDetailError(null);
      try {
        const response = await api.getDemand(id, controller.signal, onUnauthorized);
        if (detailRequestRef.current === controller && !controller.signal.aborted) {
          let nextDemand = response.demand;
          let nextTasks = response.tasks;

          // Se a demanda antiga ainda não tinha registro de execução, cria automaticamente nos bastidores
          if (nextTasks.length === 0 && session.permissions.includes('tasks.manage')) {
            try {
              const createdTaskRes = await api.createTask(
                {
                  demandId: nextDemand.id,
                  assignedToUserId: session.user.id,
                  title: nextDemand.title,
                  description: nextDemand.description,
                  priority: nextDemand.priority,
                  deliveryDate: nextDemand.deliveryDate,
                  requirements: [],
                  dependsOnTaskIds: [],
                },
                controller.signal,
                onUnauthorized,
              );
              nextTasks = [createdTaskRes.task];
            } catch {
              // Se não puder criar automaticamente, segue com os dados existentes
            }
          }

          // Se a execução já foi concluída e a demanda ainda está open, sincroniza automaticamente
          if (
            nextDemand.status === 'open' &&
            nextTasks.length > 0 &&
            nextTasks.every((t) => t.status === 'completed') &&
            session.permissions.includes('demands.write')
          ) {
            try {
              const completedRes = await api.completeDemand(
                nextDemand.id,
                { version: nextDemand.version },
                controller.signal,
                onUnauthorized,
              );
              nextDemand = completedRes.demand;
            } catch {
              // Ignora caso já tenha sido concluída em paralelo
            }
          }

          setDemand(nextDemand);
          setTasks(nextTasks);
          setSelectedTaskId((prev) => {
            if (prev && nextTasks.some((t) => t.id === prev)) return prev;
            return nextTasks[0]?.id ?? null;
          });
        }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (detailRequestRef.current === controller) {
          if (error instanceof ApiError && error.status === 404) {
            setDetailError('Esta demanda não está mais acessível para sua conta.');
          } else if (error instanceof ApiError && error.status === 403) {
            setDetailError('Você não tem permissão para visualizar esta demanda.');
          } else {
            setDetailError('Não foi possível carregar os detalhes da demanda. Tente novamente.');
          }
        }
      } finally {
        if (detailRequestRef.current === controller) {
          if (!refreshInPlace) {
            setDetailLoading(false);
          }
          detailRequestRef.current = null;
        }
      }
    },
    [onUnauthorized, session.permissions, session.user.id],
  );

  // Abort in-flight detail request only when the component unmounts (never on filter changes).
  useEffect(() => {
    return () => {
      detailRequestRef.current?.abort();
    };
  }, []);

  // Sincronização com o endereço: deep link, F5, voltar/avançar e navegação externa (Painel,
  // notificações). O backend revalida permissões no getDemand — não burla a autorização.
  // Enquanto o chamado do endereço carrega, a seleção intermediária não é reportada.
  const selectionRef = useRef<{ demandId: string | null; taskId: string | null }>({ demandId: null, taskId: null });
  const routeSyncRef = useRef(false);
  useEffect(() => {
    selectionRef.current = { demandId: selectedDemandId, taskId: selectedTaskId };
  }, [selectedDemandId, selectedTaskId]);

  useEffect(() => {
    const current = selectionRef.current;
    if (routeDemandId === current.demandId && routeTaskId === current.taskId) return;
    if (!routeDemandId) {
      setSelectedDemandId(null);
      setSelectedTaskId(null);
      return;
    }
    if (routeDemandId === current.demandId) {
      setSelectedTaskId(routeTaskId);
      return;
    }
    let cancelled = false;
    routeSyncRef.current = true;
    void (async () => {
      setSelectedDemandId(routeDemandId);
      await loadDemandDetail(routeDemandId);
      if (cancelled) return;
      setSelectedTaskId(routeTaskId);
      routeSyncRef.current = false;
    })();
    return () => {
      cancelled = true;
      routeSyncRef.current = false;
    };
  }, [routeDemandId, routeTaskId, loadDemandDetail]);

  useEffect(() => {
    if (routeSyncRef.current) return;
    onNavigate?.(selectedDemandId, selectedTaskId);
  }, [selectedDemandId, selectedTaskId, onNavigate]);

  // ============ History loader ============
  async function openHistory() {
    if (!demand || historyLoading) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    const controller = new AbortController();
    try {
      const response = await api.getDemandHistory(demand.id, controller.signal, onUnauthorized);
      setEvents(response.events);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof ApiError && error.status === 403) {
        setHistoryError('Você não tem permissão para ver o histórico desta demanda.');
      } else {
        setHistoryError('Não foi possível carregar o histórico. Tente novamente.');
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  // ============ Handlers: search/filters ============
  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchQuery);
  }

  function handleClearSearch() {
    setSearchQuery('');
    setAppliedSearch('');
    setPage(1);
  }

  // ============ Create demand ============
  function openCreateDemand() {
    setDemandFormOpen(true);
    if (!clientsLoaded && hasDemandsWrite) {
      void loadClientsList();
    }
  }

  const closeCreateDemand = useCallback(() => setDemandFormOpen(false), []);

  function handleDemandCreated(created: Demand) {
    setDemandFormOpen(false);
    setSelectedDemandId(created.id);
    void loadDemandDetail(created.id);
    void loadDemands(page, status, priority, appliedSearch);
  }

  function handleDemandCreatedFromTemplate(createdDemandId: string, createdTitle: string) {
    showToast(`Chamado "${createdTitle}" criado a partir do template com sucesso.`);
    setSelectedDemandId(createdDemandId);
    void loadDemandDetail(createdDemandId);
    void loadDemands(1, status, priority, appliedSearch);
  }

  // ============ Edit demand (data geral explícita / admin) ============
  function openEditDemand() {
    if (!demand) return;
    if (editBusy) return;
    setEditForm({
      clientId: demand.clientId,
      title: demand.title,
      description: demand.description,
      priority: demand.priority,
      deliveryDate: demand.deliveryDate,
    });
    setEditVersion(demand.version);
    setEditError(null);
    setEditVersionConflict(false);
    setEditOpen(true);
  }

  async function handleEditDemand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demand || editSubmittingRef.current || editVersion === null) return;
    editSubmittingRef.current = true;
    setEditBusy(true);
    setEditError(null);
    setEditVersionConflict(false);

    const payload = {
      version: editVersion,
      title: editForm.title.trim(),
      description: editForm.description.trim(),
      priority: editForm.priority,
      deliveryDate: editForm.deliveryDate,
    };
    const validation = updateDemandSchema.safeParse(payload);
    if (!validation.success) {
      const firstIssue = validation.error.issues[0];
      const fieldName = firstIssue?.path[0] as string | undefined;
      let errorMessage = firstIssue?.message || 'Verifique os dados preenchidos.';
      if (fieldName === 'title') {
        errorMessage = 'O título do chamado é obrigatório (1 a 160 caracteres).';
        editTitleInputRef.current?.focus();
      } else if (fieldName === 'description') {
        errorMessage = 'A descrição não pode exceder 5000 caracteres.';
      } else if (fieldName === 'deliveryDate') {
        errorMessage = 'Informe a data de entrega geral do chamado.';
      }
      setEditError(errorMessage);
      editSubmittingRef.current = false;
      setEditBusy(false);
      return;
    }

    const controller = new AbortController();
    try {
      await api.updateDemand(demand.id, validation.data, controller.signal, onUnauthorized);
      setEditOpen(false);
      showToast('Dados do chamado atualizados com sucesso.');
      setDemandFormOpen(false);
      if (selectedDemandId) {
        void loadDemandDetail(selectedDemandId);
      }
      void loadDemands(page, status, priority, appliedSearch);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setEditVersionConflict(true);
        setEditError(
          'Este chamado foi alterado por outro processo enquanto você editava.',
        );
      } else if (error instanceof ApiError && error.status === 403) {
        setEditError('Você não tem permissão para editar esta demanda.');
      } else if (error instanceof ApiError && error.status === 404) {
        setEditError('Esta demanda não está mais acessível para sua conta.');
      } else {
        setEditError('Não foi possível salvar as alterações. Verifique os dados e tente novamente.');
      }
    } finally {
      editSubmittingRef.current = false;
      setEditBusy(false);
    }
  }

  async function reloadLatestDemandVersion() {
    if (editSubmittingRef.current || !demand) return;
    editSubmittingRef.current = true;
    setEditBusy(true);
    setEditError(null);
    const controller = new AbortController();
    try {
      const response = await api.getDemand(demand.id, controller.signal, onUnauthorized);
      const latest = response.demand;
      // Refetch the full detail to keep tasks in sync and use the latest version.
      setDemand(latest);
      setTasks(response.tasks);
      setEditForm({
        clientId: latest.clientId,
        title: latest.title,
        description: latest.description,
        priority: latest.priority,
        deliveryDate: latest.deliveryDate,
      });
      setEditVersion(latest.version);
      setEditVersionConflict(false);
      setNotice('Dados atualizados carregados; rascunho anterior descartado.');
    } catch {
      setEditError('Não foi possível obter a versão mais recente do chamado. Tente novamente.');
    } finally {
      editSubmittingRef.current = false;
      setEditBusy(false);
    }
  }

  // ============ Complete demand ============
  function openCompleteDemand() {
    if (completeActionBusyRef.current) return;
    setCompleteError(null);
    setCompleteConfirm(true);
  }

  async function handleCompleteConfirm() {
    if (completeActionBusyRef.current || !demand) return;
    completeActionBusyRef.current = true;
    setCompleteBusy(true);
    setCompleteError(null);
    const controller = new AbortController();
    try {
      const response = await api.completeDemand(demand.id, { version: demand.version }, controller.signal, onUnauthorized);
      setCompleteConfirm(false);
      showToast(`Demanda "${response.demand.title}" concluída com sucesso.`);
      if (selectedDemandId) {
        void loadDemandDetail(selectedDemandId);
      }
      void loadDemands(page, status, priority, appliedSearch);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setCompleteError('Este chamado foi modificado recentemente. Feche esta caixa e recarregue os detalhes.');
      } else if (error instanceof ApiError && error.status === 403) {
        setCompleteError('Você não tem permissão para concluir demandas.');
      } else if (error instanceof ApiError && error.status === 404) {
        setCompleteError('Esta demanda não está mais acessível para sua conta. Feche esta caixa e volte à lista.');
      } else if (error instanceof ApiError && error.code === 'TASKS_NOT_COMPLETED') {
        setCompleteError('Conclua todas as tarefas do chamado antes de concluí-lo.');
      } else if (error instanceof ApiError && error.code === 'DEMAND_HAS_NO_TASKS') {
        setCompleteError('Adicione ao menos uma tarefa ao chamado antes de concluí-lo.');
      } else if (error instanceof ApiError && error.code === 'DEMAND_ALREADY_COMPLETED') {
        setCompleteError('Este chamado já foi concluído. Feche esta caixa e recarregue os detalhes.');
      } else {
        setCompleteError('Não foi possível concluir a demanda. Tente novamente.');
      }
    } finally {
      completeActionBusyRef.current = false;
      setCompleteBusy(false);
    }
  }

  // Native dialog lifecycle for complete
  useEffect(() => {
    const dialog = completeDialogRef.current;
    if (!dialog) return;
    if (completeConfirm) {
      setCompleteError(null);
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [completeConfirm]);

  // ============ Derived UI helpers ============
  function formatDateTime(iso: string): string {
    try {
      const date = new Date(iso);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return iso;
    }
  }

  function demandStatusLabel(d: Demand): string {
    return d.status === 'completed' ? 'Concluída' : 'Em aberto';
  }

  function canDeleteDemand(d: Demand | null | undefined): boolean {
    return Boolean(isAdmin && d && d.createdByUserId === session.user.id);
  }

  function openDeleteDemand(target: Demand) {
    if (deleteBusy) return;
    setDeleteError(null);
    setDeleteTarget(target);
  }

  async function handleConfirmDeleteDemand() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const controller = new AbortController();
    try {
      await api.deleteDemand(deleteTarget.id, controller.signal, onUnauthorized);
      const deletedTitle = deleteTarget.title;
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      showToast(`Demanda "${deletedTitle}" excluída com sucesso.`);
      if (selectedDemandId === deletedId) {
        setSelectedDemandId(null);
        setDemand(null);
        setTasks([]);
      }
      void loadDemands(page, status, priority, appliedSearch);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setDeleteError('Apenas o administrador que criou esta demanda pode excluí-la.');
      } else if (error instanceof ApiError && error.status === 404) {
        setDeleteError('Esta demanda já foi removida.');
      } else {
        setDeleteError('Não foi possível excluir a demanda. Tente novamente.');
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  const allTasksCompleted = tasks.length > 0 && tasks.every((t) => t.status === 'completed');
  const canCompleteDemand = isAdmin && hasDemandsWrite && demand?.status === 'open';

  // ============ Render: list ============
  if (!selectedDemandId) {
    return (
      <section className="view-panel" aria-labelledby="demands-heading">
        <div className="panel-header">
          <div>
            <h1 id="demands-heading">{isAdmin ? 'Demandas' : 'Minhas demandas'}</h1>
            <p className="panel-subtitle">
              {isAdmin
                ? 'Acompanhe todas as demandas, responsáveis e prazos de entrega.'
                : 'Aqui aparecem as demandas atribuídas a você.'}
            </p>
          </div>
          <div className="panel-actions">
            {hasDemandsWrite && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setUseTemplateOpen(true)}
                disabled={loading}
              >
                Usar template
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setManageTemplatesOpen(true)}
                disabled={loading}
              >
                Gerenciar templates
              </button>
            )}
            {isAdmin && hasDemandsWrite && (
              <button
                type="button"
                className="primary-button"
                onClick={openCreateDemand}
                disabled={loading || demandFormOpen}
              >
                + Nova demanda
              </button>
            )}
          </div>
        </div>

        {notice && (
          <div className="alert-banner success" role="status">
            <span>{notice}</span>
            <button type="button" className="close-alert" onClick={() => setNotice(null)} aria-label="Fechar aviso">
              ✕
            </button>
          </div>
        )}

        {/* Toolbar: search and filters */}
        <div className="toolbar">
          <form className="search-form" onSubmit={handleSearchSubmit} role="search">
            <label htmlFor="demand-search" className="sr-only">
              Pesquisar demandas
            </label>
            <input
              id="demand-search"
              type="search"
              placeholder="Pesquisar por título ou descrição…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <button type="submit" className="secondary-button" disabled={loading}>
              Pesquisar
            </button>
            {appliedSearch && (
              <button type="button" className="text-button" onClick={handleClearSearch}>
                Limpar busca
              </button>
            )}
          </form>

          <div className="filter-group" role="group" aria-label="Filtro por status">
            <span className="filter-label">Status:</span>
            {(['open', 'completed', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-button ${status === s ? 'active' : ''}`}
                onClick={() => {
                  setStatus(s);
                  setPage(1);
                }}
                aria-pressed={status === s}
              >
                {s === 'open' ? 'Em aberto' : s === 'completed' ? 'Concluídas' : 'Todas'}
              </button>
            ))}
          </div>

          <div className="filter-group" role="group" aria-label="Filtro por prioridade">
            <span className="filter-label">Prioridade:</span>
            {(['all', 'low', 'normal', 'high', 'urgent'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`filter-button ${priority === p ? 'active' : ''}`}
                onClick={() => {
                  setPriority(p);
                  setPage(1);
                }}
                aria-pressed={priority === p}
              >
                {priorityLabels[p]}
              </button>
            ))}
          </div>
        </div>

        {/* List content */}
        {loading ? (
          <div className="empty-state" aria-live="polite">
            <p className="status-text">Carregando demandas…</p>
          </div>
        ) : listError ? (
          <div className="empty-state error" role="alert">
            <p className="error-text">{listError}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void loadDemands(page, status, priority, appliedSearch)}
            >
              Tentar novamente
            </button>
          </div>
        ) : demands.length === 0 ? (
          <div className="empty-state">
            {appliedSearch ? (
              <>
                <p className="empty-title">Nenhuma demanda encontrada para a pesquisa informada.</p>
                <p className="empty-description">Tente pesquisar com outro termo ou limpe os filtros.</p>
                <button type="button" className="secondary-button" onClick={handleClearSearch}>
                  Limpar pesquisa
                </button>
              </>
            ) : isAdmin ? (
              <>
                <p className="empty-title">Nenhuma demanda cadastrada ainda.</p>
                <p className="empty-description">Comece abrindo a primeira demanda de um cliente.</p>
                {hasDemandsWrite && (
                  <button type="button" className="primary-button" onClick={openCreateDemand}>
                    + Nova demanda
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="empty-title">Nenhuma demanda atribuída a você ainda.</p>
                <p className="empty-description">Quando o responsável atribuir demandas para você, elas aparecerão aqui.</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table" aria-label="Tabela de demandas">
                <thead>
                  <tr>
                    <th scope="col">Demanda</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Prioridade</th>
                    <th scope="col">Entrega</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {demands.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="demand-title">{d.title}</div>
                        <div className="client-notes">#{d.id.slice(0, 8)}</div>
                      </td>
                      <td>{d.client.name}</td>
                      <td>
                        <span className={`priority-badge ${d.priority}`}>{priorityLabels[d.priority]}</span>
                      </td>
                      <td>
                        <span className={d.status === 'open' ? 'date-value' : 'muted-dash'}>
                          <DeadlineDate date={d.deliveryDate} done={d.status !== 'open'} />
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${d.status === 'completed' ? 'complete' : 'open'}`}>
                          {demandStatusLabel(d)}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="action-buttons">
                          {onOpenMaterials && hasMaterialsRead && (
                            <button
                              type="button"
                              className="action-btn secondary"
                              onClick={() => onOpenMaterials({ clientId: d.clientId, demandId: d.id })}
                              title={`Ver materiais de ${d.title}`}
                            >
                              Materiais
                            </button>
                          )}
                          <button
                            type="button"
                            className="action-btn edit"
                            onClick={() => {
                              setSelectedDemandId(d.id);
                              void loadDemandDetail(d.id);
                            }}
                          >
                            Ver detalhes
                          </button>
                          {canDeleteDemand(d) && (
                            <button
                              type="button"
                              className="action-btn archive"
                              onClick={() => openDeleteDemand(d)}
                              title="Excluir demanda (disponível apenas para o administrador que a criou)"
                            >
                              Excluir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="pagination-bar">
              <span className="pagination-info">
                Página {page} de {Math.max(1, Math.ceil(total / pageSize))} ({total} {total === 1 ? 'demanda' : 'demandas'} no total)
              </span>
              <div className="pagination-controls">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPage((p) => Math.min(Math.max(1, Math.ceil(total / pageSize)), p + 1))}
                  disabled={page >= Math.max(1, Math.ceil(total / pageSize)) || loading}
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        )}

        {/* Create demand modal pop-up (admin) */}
        {isAdmin && demandFormOpen && (
          <CreateDemandModal
            currentUserId={session.user.id}
            clients={clients}
            clientsLoaded={clientsLoaded}
            users={users}
            usersLoaded={usersLoaded}
            onClose={closeCreateDemand}
            onCreated={handleDemandCreated}
            onUnauthorized={onUnauthorized}
          />
        )}

        {/* Modals for templates */}
        <UseTemplateModal
          isOpen={useTemplateOpen}
          onClose={() => setUseTemplateOpen(false)}
          clients={clients}
          users={users}
          onDemandCreated={handleDemandCreatedFromTemplate}
          onUnauthorized={onUnauthorized}
        />

        <ManageTemplatesModal
          isOpen={manageTemplatesOpen}
          onClose={() => setManageTemplatesOpen(false)}
          onUnauthorized={onUnauthorized}
        />

        {deleteTarget && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-demand-list-heading"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !deleteBusy) {
                setDeleteTarget(null);
              }
            }}
          >
            <div className="modal-card" style={{ maxWidth: 460 }}>
              <div className="modal-header">
                <h2 id="delete-demand-list-heading">Excluir demanda</h2>
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteBusy}
                  aria-label="Fechar confirmação"
                >
                  ✕
                </button>
              </div>
              <div className="modal-body" style={{ marginBottom: 0 }}>
                {deleteError && (
                  <div className="alert-banner error" role="alert">
                    <span>{deleteError}</span>
                  </div>
                )}
                <p style={{ margin: '0 0 8px' }}>
                  Deseja excluir permanentemente a demanda <strong>&ldquo;{deleteTarget.title}&rdquo;</strong> ({deleteTarget.client.name})?
                </p>
                <p className="muted-text" style={{ margin: '0 0 18px' }}>
                  Esta ação remove a demanda e todo o seu histórico de execução e comentários. Não pode ser desfeita.
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setDeleteTarget(null)}
                    disabled={deleteBusy}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void handleConfirmDeleteDemand()}
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? 'Excluindo…' : 'Sim, excluir demanda'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </section>
    );
  }

  // ============ Render: detail ============
  return (
    <section className="view-panel" aria-labelledby="demand-detail-heading">
      <div className="panel-header">
        <div>
          <div className="back-row">
            <button
              type="button"
              className="text-button"
              onClick={() => setSelectedDemandId(null)}
              aria-label="Voltar para a lista de demandas"
            >
              ← Voltar para as demandas
            </button>
          </div>
          <h1 id="demand-detail-heading">{demand?.title ?? 'Detalhes da demanda'}</h1>
          <p className="panel-subtitle">
            {demand ? (
              <>
                {demand.client.name} • Prioridade{' '}
                <span className={`priority-badge ${demand.priority}`}>{priorityLabels[demand.priority]}</span>{' '}
                • Entrega: <strong><DeadlineDate date={demand.deliveryDate} done={demand.status !== 'open'} /></strong>
                {' • '}
                <span className={`status-badge ${demand.status === 'completed' ? 'complete' : 'open'}`}>
                  {demandStatusLabel(demand)}
                </span>
              </>
            ) : (
              'Carregando detalhes…'
            )}
          </p>
        </div>
      </div>

      {detailError ? (
        <div className="empty-state error" role="alert">
          <p className="error-text">{detailError}</p>
          <button type="button" className="secondary-button" onClick={() => setSelectedDemandId(null)}>
            Voltar para a lista
          </button>
        </div>
      ) : (
        <>
          {notice && (
            <div className="alert-banner success" role="status">
              <span>{notice}</span>
              <button type="button" className="close-alert" onClick={() => setNotice(null)} aria-label="Fechar aviso">
                ✕
              </button>
            </div>
          )}

          {detailLoading ? (
            <div className="empty-state" aria-live="polite">
              <p className="status-text">Carregando demanda…</p>
            </div>
          ) : (
            <>
              {demand && demand.description.trim() && (
                <p className="description-text">{demand.description}</p>
              )}

              {/* Actions */}
              <div className="detail-actions" role="group" aria-label="Ações da demanda">
                {onOpenMaterials && hasMaterialsRead && demand && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onOpenMaterials({ clientId: demand.clientId, demandId: demand.id })}
                    title="Ver materiais desta demanda"
                  >
                    Materiais
                  </button>
                )}
                {isAdmin && hasDemandsWrite && (
                  <button type="button" className="secondary-button" onClick={openEditDemand} disabled={editOpen || !demand}>
                    Editar demanda
                  </button>
                )}
                {isAdmin && (
                  <button type="button" className="secondary-button" onClick={() => void openHistory()} disabled={historyLoading}>
                    {historyOpen ? 'Histórico carregado' : 'Histórico'}
                  </button>
                )}
                {isAdmin && canCompleteDemand && allTasksCompleted && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={openCompleteDemand}
                  >
                    Concluir demanda
                  </button>
                )}
                {canDeleteDemand(demand) && demand && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => openDeleteDemand(demand)}
                    title="Excluir demanda (disponível apenas para o administrador que a criou)"
                  >
                    Excluir demanda
                  </button>
                )}
              </div>

              {/* Edit demand inline form (admin) */}
              {isAdmin && editOpen && demand && (
                <section className="inline-panel" aria-labelledby="edit-demand-heading">
                  <div className="panel-header">
                    <h2 id="edit-demand-heading">Editar demanda</h2>
                    <button
                      type="button"
                      className="close-button"
                      onClick={() => setEditOpen(false)}
                      aria-label="Fechar formulário"
                      disabled={editBusy}
                    >
                      ✕
                    </button>
                  </div>
                  <form onSubmit={(event) => void handleEditDemand(event)} noValidate>
                    {editError && (
                      <div className="alert-banner error" role="alert">
                        <span>{editError}</span>
                        {editVersionConflict && (
                          <div className="conflict-resolution" style={{ marginTop: 8 }}>
                            <p style={{ margin: '0 0 8px 0', fontSize: '0.875rem' }}>
                              Atenção: ao carregar os dados mais recentes do servidor, o seu rascunho atual com as alterações não salvas será descartado.
                            </p>
                            <button
                              type="button"
                              className="primary-button small"
                              onClick={() => void reloadLatestDemandVersion()}
                              disabled={editBusy}
                            >
                              Descartar rascunho e carregar dados do servidor
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="form-field">
                      <label htmlFor="edit-demand-title">Título da demanda *</label>
                      <input
                        ref={editTitleInputRef}
                        id="edit-demand-title"
                        type="text"
                        maxLength={160}
                        value={editForm.title}
                        onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                        required
                        disabled={editBusy}
                      />
                    </div>

                    <div className="form-field">
                      <label htmlFor="edit-demand-description">Descrição</label>
                      <textarea
                        id="edit-demand-description"
                        rows={4}
                        maxLength={5000}
                        value={editForm.description}
                        onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
                        disabled={editBusy}
                      />
                    </div>

                    <div className="form-row">
                      <div className="form-field">
                        <label htmlFor="edit-demand-priority">Prioridade</label>
                        <select
                          id="edit-demand-priority"
                          value={editForm.priority}
                          onChange={(event) =>
                            setEditForm({ ...editForm, priority: event.target.value as DemandFormState['priority'] })
                          }
                          disabled={editBusy}
                        >
                          <option value="low">Baixa</option>
                          <option value="normal">Normal</option>
                          <option value="high">Alta</option>
                          <option value="urgent">Urgente</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label htmlFor="edit-demand-date" className="fieldset-label">
                          Data de entrega *
                        </label>
                        <input
                          id="edit-demand-date"
                          type="date"
                          value={editForm.deliveryDate}
                          onChange={(event) => setEditForm({ ...editForm, deliveryDate: event.target.value })}
                          required
                          disabled={editBusy}
                        />
                      </div>
                    </div>

                    <div className="panel-actions">
                      <button type="button" className="secondary-button" onClick={() => setEditOpen(false)} disabled={editBusy}>
                        Cancelar
                      </button>
                      <button type="submit" className="primary-button" disabled={editBusy}>
                        {editBusy ? 'Salvando…' : 'Salvar alterações'}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              {/* History */}
              {isAdmin && historyOpen && (
                <section className="history-panel" aria-labelledby="history-title">
                  <div className="section-heading-row">
                    <h2 className="section-heading" id="history-title">Histórico da demanda</h2>
                    <button type="button" className="close-button" onClick={() => setHistoryOpen(false)} aria-label="Fechar histórico">
                      ✕
                    </button>
                  </div>
                  {historyLoading ? (
                    <p className="status-text">Carregando histórico…</p>
                  ) : historyError ? (
                    <p className="error-text">{historyError}</p>
                  ) : events.length === 0 ? (
                    <p className="muted-text">Ainda não há eventos registrados para esta demanda.</p>
                  ) : (
                    <ol className="event-list">
                      {events.map((event) => (
                        <li key={event.id} className="event-item">
                          <div className="event-header">
                            <span className="event-action">{event.action}</span>
                            <span className="event-meta">
                              {event.actorName} • {formatDateTime(event.createdAt)}
                            </span>
                          </div>
                          {event.reason && <p className="event-reason">{event.reason}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}

              {/* Visão unificada da Demanda (Andamento, Checklist e Comentários) */}
              {(selectedTaskId ?? tasks[0]?.id) ? (
                <div className="task-detail-shell" style={{ marginTop: 16 }}>
                  <TaskDetailView
                    taskId={(selectedTaskId ?? tasks[0]?.id)!}
                    session={session}
                    availableTasks={tasks}
                    embeddedInDemand={true}
                    onUnauthorized={onUnauthorized}
                    onChanged={() => {
                      if (selectedDemandId) {
                        void loadDemandDetail(selectedDemandId, true);
                      }
                    }}
                    onBack={() => setSelectedDemandId(null)}
                  />
                </div>
              ) : null}
            </>
          )}
        </>
      )}

      {/* Complete demand dialog (stable node) */}
      <dialog
        ref={completeDialogRef}
        className="native-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!completeActionBusyRef.current) {
              setCompleteConfirm(false);
              setCompleteError(null);
            }
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!completeBusy) {
            setCompleteConfirm(false);
            setCompleteError(null);
          }
        }}
      >
        <div className="dialog-header">
          <h2>Concluir chamado</h2>
          <button
            type="button"
            className="close-button"
            onClick={() => {
              setCompleteConfirm(false);
              setCompleteError(null);
            }}
            aria-label="Fechar"
            disabled={completeBusy}
          >
            ✕
          </button>
        </div>
        <div className="dialog-body">
          {completeError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: 12 }}>
              <span>{completeError}</span>
            </div>
          )}
          <p>
            Deseja concluir o chamado <strong>&ldquo;{demand?.title}&rdquo;</strong>?
          </p>
          <p className="muted-text">
            A conclusão só é possível quando todas as tarefas estiverem concluídas e este passo é registrado no histórico.
          </p>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setCompleteConfirm(false);
              setCompleteError(null);
            }}
            disabled={completeBusy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void handleCompleteConfirm()}
            disabled={completeBusy}
          >
            {completeBusy ? 'Concluindo…' : 'Sim, concluir chamado'}
          </button>
        </div>
      </dialog>

      {deleteTarget && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-demand-detail-heading"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleteBusy) {
              setDeleteTarget(null);
            }
          }}
        >
          <div className="modal-card" style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h2 id="delete-demand-detail-heading">Excluir demanda</h2>
              <button
                type="button"
                className="close-button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
                aria-label="Fechar confirmação"
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ marginBottom: 0 }}>
              {deleteError && (
                <div className="alert-banner error" role="alert">
                  <span>{deleteError}</span>
                </div>
              )}
              <p style={{ margin: '0 0 8px' }}>
                Deseja excluir permanentemente a demanda <strong>&ldquo;{deleteTarget.title}&rdquo;</strong> ({deleteTarget.client.name})?
              </p>
              <p className="muted-text" style={{ margin: '0 0 18px' }}>
                Esta ação remove a demanda e todo o seu histórico de execução e comentários. Não pode ser desfeita.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteBusy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void handleConfirmDeleteDemand()}
                  disabled={deleteBusy}
                >
                  {deleteBusy ? 'Excluindo…' : 'Sim, excluir demanda'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
