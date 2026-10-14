import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createDemandSchema,
  createTaskSchema,
  updateDemandSchema,
  type Client,
  type Demand,
  type DemandEvent,
  type SessionResponse,
  type Task,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { TaskDetailView } from './TaskDetailView.js';
import { UseTemplateModal } from './UseTemplateModal.js';
import { ManageTemplatesModal } from './ManageTemplatesModal.js';
import type {
  DemandFormState,
  DemandPriorityFilter,
  DemandsStatusFilter,
  TaskFormState,
  UserListItem,
} from '../types.js';

interface DemandsViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  /** Navegação externa (ex.: Painel) para abrir um chamado/tarefa sem duplicar lógica. */
  initialDemandId?: string | null;
  initialTaskId?: string | null;
  onNavigationConsumed?: () => void;
  onOpenMaterials?: (target: { clientId?: string; demandId?: string; taskId?: string }) => void;
}

const emptyDemandForm = (): DemandFormState => ({
  clientId: '',
  title: '',
  description: '',
  priority: 'normal',
  deliveryDate: '',
});

const emptyTaskForm = (): TaskFormState => ({
  assignedToUserId: '',
  title: '',
  description: '',
  priority: 'normal',
  deliveryDate: '',
  requirements: [{ title: '', mandatory: false }],
  dependsOnTaskIds: [],
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
  initialDemandId,
  initialTaskId,
  onNavigationConsumed,
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
  const [demandForm, setDemandForm] = useState<DemandFormState>(emptyDemandForm);
  const [demandFormBusy, setDemandFormBusy] = useState(false);
  const [demandFormError, setDemandFormError] = useState<string | null>(null);
  const demandFormSubmittingRef = useRef(false);
  const demandTitleInputRef = useRef<HTMLInputElement>(null);

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

  // ---------------- Create task form ----------------
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<TaskFormState>(emptyTaskForm);
  const [taskFormBusy, setTaskFormBusy] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const taskFormSubmittingRef = useRef(false);
  const assigneeInputRef = useRef<HTMLSelectElement>(null);
  const taskTitleInputRef = useRef<HTMLInputElement>(null);

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

  const usersById = useMemo(() => {
    const map: Record<string, { name: string; id: string }> = {};
    for (const user of users) {
      map[user.id] = user;
    }
    return map;
  }, [users]);

  function userName(userId: string): string {
    const user = usersById[userId];
    return user ? user.name : userId;
  }

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
          setDemand(response.demand);
          setTasks(response.tasks);
          if (!refreshInPlace) {
            setSelectedTaskId(null);
          }
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
    [onUnauthorized],
  );

  // Abort in-flight detail request only when the component unmounts (never on filter changes).
  useEffect(() => {
    return () => {
      detailRequestRef.current?.abort();
    };
  }, []);

  // Navegação externa (ex.: Painel): abre um chamado opcionalmente posicionando uma tarefa.
  // O backend revalida permissões no getDemand — não burla a autorização existente.
  // Guarda de geração: a continuação após o await só roda se ainda for o alvo atual
  // (não aborta o request legítimo do loadDemandDetail de outra geração).
  useEffect(() => {
    if (!initialDemandId) return;
    let cancelled = false;
    void (async () => {
      setSelectedDemandId(initialDemandId);
      await loadDemandDetail(initialDemandId);
      if (cancelled) return;
      if (initialTaskId) {
        setSelectedTaskId(initialTaskId);
      }
      if (!cancelled) {
        onNavigationConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDemandId, initialTaskId, loadDemandDetail, onNavigationConsumed]);

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
    if (demandFormBusy) return;
    setDemandForm(emptyDemandForm());
    setDemandFormError(null);
    setDemandFormOpen(true);
    if (!clientsLoaded && hasDemandsWrite) {
      void loadClientsList();
    }
  }

  useEffect(() => {
    if (!demandFormOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !demandFormBusy) {
        setDemandFormOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [demandFormOpen, demandFormBusy]);

  async function handleCreateDemand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demandFormSubmittingRef.current) return;
    demandFormSubmittingRef.current = true;
    setDemandFormBusy(true);
    setDemandFormError(null);

    const payload = {
      clientId: demandForm.clientId,
      title: demandForm.title.trim(),
      description: demandForm.description.trim(),
      priority: demandForm.priority,
      deliveryDate: demandForm.deliveryDate,
    };
    const validation = createDemandSchema.safeParse(payload);
    if (!validation.success) {
      const firstIssue = validation.error.issues[0];
      const fieldName = firstIssue?.path[0] as string | undefined;
      if (fieldName === 'clientId') {
        setDemandFormError('Selecione o cliente do chamado.');
      } else if (fieldName === 'title') {
        demandTitleInputRef.current?.focus();
        setDemandFormError('O título do chamado é obrigatório (1 a 160 caracteres).');
      } else if (fieldName === 'description') {
        setDemandFormError('A descrição não pode exceder 5000 caracteres.');
      } else if (fieldName === 'deliveryDate') {
        setDemandFormError('Informe a data de entrega geral do chamado.');
      } else {
        setDemandFormError(firstIssue?.message || 'Verifique os dados preenchidos.');
      }
      demandFormSubmittingRef.current = false;
      setDemandFormBusy(false);
      return;
    }

    const controller = new AbortController();
    try {
      const response = await api.createDemand(validation.data, controller.signal, onUnauthorized);
      const created = response.demand;
      setDemandFormOpen(false);
      setNotice(`${created.title} criado com sucesso.`);
      setSelectedDemandId(created.id);
      void loadDemandDetail(created.id);
      void loadDemands(page, status, priority, appliedSearch);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setDemandFormError('Você não tem permissão para criar demandas.');
      } else if (error instanceof ApiError && error.status === 404) {
        setDemandFormError('O cliente selecionado não está ativo ou não foi encontrado.');
      } else {
        setDemandFormError('Não foi possível criar a demanda. Verifique os dados e tente novamente.');
      }
    } finally {
      demandFormSubmittingRef.current = false;
      setDemandFormBusy(false);
    }
  }

  function handleDemandCreatedFromTemplate(createdDemandId: string, createdTitle: string) {
    setNotice(`Chamado "${createdTitle}" criado a partir do template com sucesso.`);
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
      setNotice('Dados do chamado atualizados com sucesso.');
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
      setNotice(`Demanda "${response.demand.title}" concluída com sucesso.`);
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

  // ============ Create task ============
  function openCreateTask() {
    if (taskFormBusy) return;
    const form = emptyTaskForm();
    if (demand) {
      form.deliveryDate = demand.deliveryDate;
    }
    setTaskForm(form);
    setTaskFormError(null);
    setTaskFormOpen(true);
  }

  function setRequirement(index: number, patch: Partial<{ title: string; mandatory: boolean }>) {
    setTaskForm((prev) => {
      const next = [...prev.requirements];
      const current = next[index] ?? { title: '', mandatory: false };
      next[index] = { ...current, ...patch };
      return { ...prev, requirements: next };
    });
  }

  function addRequirement() {
    setTaskForm((prev) => ({
      ...prev,
      requirements: [...prev.requirements, { title: '', mandatory: false }],
    }));
  }

  function removeRequirement(index: number) {
    setTaskForm((prev) => ({
      ...prev,
      requirements: prev.requirements.filter((_, i) => i !== index),
    }));
  }

  function toggleDependency(taskId: string) {
    setTaskForm((prev) => {
      const has = prev.dependsOnTaskIds.includes(taskId);
      return {
        ...prev,
        dependsOnTaskIds: has
          ? prev.dependsOnTaskIds.filter((id) => id !== taskId)
          : [...prev.dependsOnTaskIds, taskId],
      };
    });
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demand || taskFormSubmittingRef.current) return;
    taskFormSubmittingRef.current = true;
    setTaskFormBusy(true);
    setTaskFormError(null);

    const payload = {
      demandId: demand.id,
      assignedToUserId: taskForm.assignedToUserId,
      title: taskForm.title.trim(),
      description: taskForm.description.trim(),
      priority: taskForm.priority,
      deliveryDate: taskForm.deliveryDate.trim() || undefined,
      requirements: taskForm.requirements
        .filter((r) => r.title.trim().length > 0)
        .map((r) => ({ title: r.title.trim(), mandatory: r.mandatory })),
      dependsOnTaskIds: taskForm.dependsOnTaskIds,
    };

    const validation = createTaskSchema.safeParse(payload);
    if (!validation.success) {
      const firstIssue = validation.error.issues[0];
      const fieldName = firstIssue?.path[0] as string | undefined;
      let errorMessage = firstIssue?.message || 'Verifique os dados preenchidos.';
      if (fieldName === 'assignedToUserId') {
        errorMessage = 'Selecione o responsável pela tarefa.';
        assigneeInputRef.current?.focus();
      } else if (fieldName === 'title') {
        errorMessage = 'O título da tarefa é obrigatório (1 a 160 caracteres).';
        taskTitleInputRef.current?.focus();
      } else if (fieldName === 'deliveryDate') {
        errorMessage = 'A data de entrega da tarefa informada é inválida.';
      } else if (fieldName === 'requirements') {
        errorMessage = 'Revise os requisitos: cada um precisa de um título de 1 a 160 caracteres (máximo 30).';
      } else if (fieldName === 'dependsOnTaskIds') {
        errorMessage = 'Revise as dependências selecionadas (máximo 30).';
      }
      setTaskFormError(errorMessage);
      taskFormSubmittingRef.current = false;
      setTaskFormBusy(false);
      return;
    }

    const controller = new AbortController();
    try {
      const response = await api.createTask(validation.data, controller.signal, onUnauthorized);
      const created = response.task;
      setTaskFormOpen(false);
      setNotice(`Tarefa "${created.title}" criada com sucesso.`);
      setSelectedTaskId(null);
      if (selectedDemandId) {
        void loadDemandDetail(selectedDemandId);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TASK_DEPENDENCY_CYCLE') {
        setTaskFormError('As dependências escolhidas criariam um ciclo. Escolha uma combinação diferente.');
      } else if (error instanceof ApiError && error.status === 403) {
        setTaskFormError('Você não tem permissão para criar tarefas nesta demanda.');
      } else if (error instanceof ApiError && error.status === 404) {
        setTaskFormError('A demanda ou algum responsável selecionado não está mais disponível.');
      } else if (error instanceof ApiError && error.status === 409) {
        setTaskFormError('Esta demanda foi alterada por outro processo. Recarregue os detalhes e tente novamente.');
      } else {
        setTaskFormError('Não foi possível criar a tarefa. Verifique os dados e tente novamente.');
      }
    } finally {
      taskFormSubmittingRef.current = false;
      setTaskFormBusy(false);
    }
  }

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

  function taskStatusLabel(status: Task['status']): string {
    const labels: Record<Task['status'], string> = {
      blocked: 'Aguardando',
      ready: 'Pronta',
      in_production: 'Em produção',
      in_review: 'Em revisão',
      changes_requested: 'Ajustes pedidos',
      paused: 'Pausada',
      completed: 'Concluída',
    };
    return labels[status];
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
                ? 'Acompanhe os chamados, distribua tarefas e gerencie os prazos.'
                : 'Aqui aparecem os chamados com tarefas atribuídas a você.'}
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
                + Novo chamado
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
                <p className="empty-title">Nenhum chamado encontrado para a pesquisa informada.</p>
                <p className="empty-description">Tente pesquisar com outro termo ou limpe os filtros.</p>
                <button type="button" className="secondary-button" onClick={handleClearSearch}>
                  Limpar pesquisa
                </button>
              </>
            ) : isAdmin ? (
              <>
                <p className="empty-title">Nenhum chamado cadastrado ainda.</p>
                <p className="empty-description">Comece abrindo o primeiro chamado de um cliente.</p>
                {hasDemandsWrite && (
                  <button type="button" className="primary-button" onClick={openCreateDemand}>
                    + Novo chamado
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="empty-title">Nenhum chamado atribuído a você ainda.</p>
                <p className="empty-description">Quando o responsável distribuir tarefas para você, elas aparecerão aqui.</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table" aria-label="Tabela de demandas">
                <thead>
                  <tr>
                    <th scope="col">Chamado</th>
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
                        <span className={d.status === 'open' ? 'date-value' : 'muted-dash'}>{d.deliveryDate}</span>
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
                Página {page} de {Math.max(1, Math.ceil(total / pageSize))} ({total} {total === 1 ? 'chamado' : 'chamados'} no total)
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
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demand-form-heading"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !demandFormBusy) {
                setDemandFormOpen(false);
              }
            }}
          >
            <div className="modal-card">
              <div className="modal-header">
                <h2 id="demand-form-heading">Novo chamado</h2>
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setDemandFormOpen(false)}
                  aria-label="Fechar formulário"
                  disabled={demandFormBusy}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={(event) => void handleCreateDemand(event)} noValidate className="modal-body" style={{ marginBottom: 0 }}>
                {demandFormError && (
                  <div className="alert-banner error" role="alert">
                    <span>{demandFormError}</span>
                  </div>
                )}

                <div className="form-field">
                  <label htmlFor="demand-form-client">Cliente *</label>
                  <select
                    id="demand-form-client"
                    value={demandForm.clientId}
                    onChange={(event) => setDemandForm({ ...demandForm, clientId: event.target.value })}
                    disabled={demandFormBusy}
                    required
                  >
                    <option value="" disabled>
                      {clientsLoaded ? 'Selecione o cliente…' : 'Carregando clientes…'}
                    </option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label htmlFor="demand-form-title">Título do chamado *</label>
                  <input
                    ref={demandTitleInputRef}
                    id="demand-form-title"
                    type="text"
                    placeholder="Ex.: Campanha de lançamento ou Nova Landing Page"
                    maxLength={160}
                    value={demandForm.title}
                    onChange={(event) => setDemandForm({ ...demandForm, title: event.target.value })}
                    required
                    disabled={demandFormBusy}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="demand-form-description">Descrição</label>
                  <textarea
                    id="demand-form-description"
                    rows={4}
                    placeholder="Contexto, referências e orientações gerais do entregável…"
                    maxLength={5000}
                    value={demandForm.description}
                    onChange={(event) => setDemandForm({ ...demandForm, description: event.target.value })}
                    disabled={demandFormBusy}
                  />
                </div>

                <div className="form-row">
                  <div className="form-field">
                    <label htmlFor="demand-form-priority">Prioridade</label>
                    <select
                      id="demand-form-priority"
                      value={demandForm.priority}
                      onChange={(event) =>
                        setDemandForm({ ...demandForm, priority: event.target.value as DemandFormState['priority'] })
                      }
                      disabled={demandFormBusy}
                    >
                      <option value="low">Baixa</option>
                      <option value="normal">Normal</option>
                      <option value="high">Alta</option>
                      <option value="urgent">Urgente</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label htmlFor="demand-form-date" className="fieldset-label">
                      Data de entrega geral do chamado *
                    </label>
                    <input
                      id="demand-form-date"
                      type="date"
                      value={demandForm.deliveryDate}
                      onChange={(event) => setDemandForm({ ...demandForm, deliveryDate: event.target.value })}
                      required
                      disabled={demandFormBusy}
                    />
                    <span className="muted-text">Defina o prazo acordado com o cliente.</span>
                  </div>
                </div>

                <div className="modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setDemandFormOpen(false)} disabled={demandFormBusy}>
                    Cancelar
                  </button>
                  <button type="submit" className="primary-button" disabled={demandFormBusy}>
                    {demandFormBusy ? 'Criando…' : 'Abrir chamado'}
                  </button>
                </div>
              </form>
            </div>
          </div>
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
          <h1 id="demand-detail-heading">{demand?.title ?? 'Detalhes do chamado'}</h1>
          <p className="panel-subtitle">
            {demand ? (
              <>
                {demand.client.name} • Prioridade{' '}
                <span className={`priority-badge ${demand.priority}`}>{priorityLabels[demand.priority]}</span>{' '}
                • Entrega geral: <strong>{demand.deliveryDate}</strong>
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
              <p className="status-text">Carregando chamado…</p>
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
                    title="Ver materiais deste chamado"
                  >
                    Materiais
                  </button>
                )}
                {isAdmin && hasDemandsWrite && demand?.status === 'open' && (
                  <button type="button" className="primary-button" onClick={openCreateTask} disabled={taskFormOpen}>
                    + Nova tarefa
                  </button>
                )}
                {isAdmin && hasDemandsWrite && (
                  <button type="button" className="secondary-button" onClick={openEditDemand} disabled={editOpen || !demand}>
                    Editar dados do chamado
                  </button>
                )}
                {isAdmin && (
                  <button type="button" className="secondary-button" onClick={() => void openHistory()} disabled={historyLoading}>
                    {historyOpen ? 'Histórico carregado' : 'Histórico'}
                  </button>
                )}
                {isAdmin && canCompleteDemand && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={openCompleteDemand}
                    disabled={!allTasksCompleted}
                    title={allTasksCompleted ? '' : 'Conclua todas as tarefas antes de concluir o chamado'}
                  >
                    Concluir chamado
                  </button>
                )}
              </div>
              {!allTasksCompleted && canCompleteDemand && (
                <p className="muted-text" style={{ marginTop: 0 }}>
                  Para concluir o chamado, todas as tarefas precisam estar concluídas.
                </p>
              )}

              {/* Edit demand inline form (admin) */}
              {isAdmin && editOpen && demand && (
                <section className="inline-panel" aria-labelledby="edit-demand-heading">
                  <div className="panel-header">
                    <h2 id="edit-demand-heading">Editar dados do chamado</h2>
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

                    <p className="muted-text" style={{ marginBottom: 12 }}>
                      Aqui você ajusta os dados gerais do chamado. Para prazos de tarefas individuais, use os detalhes de cada tarefa.
                    </p>

                    <div className="form-field">
                      <label htmlFor="edit-demand-title">Título do chamado *</label>
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
                          Data de entrega geral do chamado *
                        </label>
                        <input
                          id="edit-demand-date"
                          type="date"
                          value={editForm.deliveryDate}
                          onChange={(event) => setEditForm({ ...editForm, deliveryDate: event.target.value })}
                          required
                          disabled={editBusy}
                        />
                        <span className="muted-text">Ajuste aqui o compromisso geral acordado com o cliente, quando necessário.</span>
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

              {/* Create task inline form (admin) */}
              {isAdmin && taskFormOpen && demand && (
                <section className="inline-panel" aria-labelledby="task-form-heading">
                  <div className="panel-header">
                    <h2 id="task-form-heading">Nova tarefa</h2>
                    <button
                      type="button"
                      className="close-button"
                      onClick={() => setTaskFormOpen(false)}
                      aria-label="Fechar formulário"
                      disabled={taskFormBusy}
                    >
                      ✕
                    </button>
                  </div>
                  <form onSubmit={(event) => void handleCreateTask(event)} noValidate>
                    {taskFormError && (
                      <div className="alert-banner error" role="alert">
                        <span>{taskFormError}</span>
                      </div>
                    )}

                    <div className="form-field">
                      <label htmlFor="task-form-assignee">Responsável *</label>
                      <select
                        ref={assigneeInputRef}
                        id="task-form-assignee"
                        value={taskForm.assignedToUserId}
                        onChange={(event) => setTaskForm({ ...taskForm, assignedToUserId: event.target.value })}
                        required
                        disabled={taskFormBusy}
                      >
                        <option value="" disabled>
                          {usersLoaded ? 'Selecione o responsável…' : 'Carregando equipe…'}
                        </option>
                        {users
                          .filter((u) => u.active)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} {u.id === session.user.id ? '(você)' : ''}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="form-field">
                      <label htmlFor="task-form-title">Título da tarefa *</label>
                      <input
                        ref={taskTitleInputRef}
                        id="task-form-title"
                        type="text"
                        maxLength={160}
                        value={taskForm.title}
                        onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                        required
                        disabled={taskFormBusy}
                      />
                    </div>

                    <div className="form-field">
                      <label htmlFor="task-form-description">Descrição</label>
                      <textarea
                        id="task-form-description"
                        rows={3}
                        maxLength={5000}
                        value={taskForm.description}
                        onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })}
                        disabled={taskFormBusy}
                      />
                    </div>

                    <div className="form-row">
                      <div className="form-field">
                        <label htmlFor="task-form-priority">Prioridade</label>
                        <select
                          id="task-form-priority"
                          value={taskForm.priority}
                          onChange={(event) =>
                            setTaskForm({ ...taskForm, priority: event.target.value as TaskFormState['priority'] })
                          }
                          disabled={taskFormBusy}
                        >
                          <option value="low">Baixa</option>
                          <option value="normal">Normal</option>
                          <option value="high">Alta</option>
                          <option value="urgent">Urgente</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label htmlFor="task-form-date" className="fieldset-label">
                          Data de entrega da tarefa *
                        </label>
                        <input
                          id="task-form-date"
                          type="date"
                          value={taskForm.deliveryDate}
                          onChange={(event) => setTaskForm({ ...taskForm, deliveryDate: event.target.value })}
                          disabled={taskFormBusy}
                        />
                        <span className="muted-text">
                          Prazo individual da tarefa; fica preenchida com a data geral do chamado e pode ser ajustada.
                        </span>
                      </div>
                    </div>

                    {/* Requirements */}
                    <fieldset className="fieldset-block">
                      <legend className="fieldset-legend">Requisitos</legend>
                      <p className="muted-text" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                        Requisitos verificáveis para concluir a tarefa (opcional). Marque como obrigatório quando o item for condição de entrega.
                      </p>
                      {taskForm.requirements.length === 0 && (
                        <p className="muted-text" style={{ fontSize: '0.875rem' }}>
                          Nenhum requisito adicionado.
                        </p>
                      )}
                      {taskForm.requirements.map((requirement, index) => (
                        <div className="requirement-row" key={index}>
                          <input
                            className="requirement-input"
                            type="text"
                            maxLength={160}
                            placeholder={`Requisito ${index + 1}`}
                            aria-label={`Título do requisito ${index + 1}`}
                            value={requirement.title}
                            onChange={(event) => setRequirement(index, { title: event.target.value })}
                            disabled={taskFormBusy || taskForm.requirements.length >= 30}
                          />
                          <label className="checkbox-label-wrapper">
                            <input
                              type="checkbox"
                              checked={requirement.mandatory}
                              onChange={(event) => setRequirement(index, { mandatory: event.target.checked })}
                              disabled={taskFormBusy}
                            />
                            <span>Obrigatório</span>
                          </label>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => removeRequirement(index)}
                            disabled={taskFormBusy}
                            aria-label={`Remover requisito ${index + 1}`}
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                      {taskForm.requirements.length > 0 && (
                        <div className="requirement-draft" aria-live="polite">
                          {taskForm.requirements.filter((r) => r.title.trim().length > 0).length} requisito(s) preenchido(s).
                        </div>
                      )}
                      <button
                        type="button"
                        className="secondary-button small"
                        onClick={addRequirement}
                        disabled={taskFormBusy || taskForm.requirements.length >= 30}
                      >
                        + Adicionar requisito
                      </button>
                    </fieldset>

                    {/* Dependencies */}
                    {tasks.length > 0 && (
                      <fieldset className="fieldset-block">
                        <legend className="fieldset-legend">Dependências da tarefa</legend>
                        <p className="muted-text" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                          Selecione tarefas deste mesmo chamado que precisam estar concluídas antes desta começar.
                        </p>
                        <div className="dependency-list">
                          {tasks.map((existing) => (
                            <label className="checkbox-label-wrapper" key={existing.id}>
                              <input
                                type="checkbox"
                                checked={taskForm.dependsOnTaskIds.includes(existing.id)}
                                onChange={() => toggleDependency(existing.id)}
                                disabled={taskFormBusy}
                              />
                              <span>
                                {existing.title} —{' '}
                                <span className={`task-badge status-${existing.status}`}>{taskStatusLabel(existing.status)}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}

                    <div className="panel-actions">
                      <button type="button" className="secondary-button" onClick={() => setTaskFormOpen(false)} disabled={taskFormBusy}>
                        Cancelar
                      </button>
                      <button type="submit" className="primary-button" disabled={taskFormBusy}>
                        {taskFormBusy ? 'Criando…' : 'Criar tarefa'}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              {/* History */}
              {isAdmin && historyOpen && (
                <section className="history-panel" aria-labelledby="history-title">
                  <div className="section-heading-row">
                    <h2 className="section-heading" id="history-title">Histórico do chamado</h2>
                    <button type="button" className="close-button" onClick={() => setHistoryOpen(false)} aria-label="Fechar histórico">
                      ✕
                    </button>
                  </div>
                  {historyLoading ? (
                    <p className="status-text">Carregando histórico…</p>
                  ) : historyError ? (
                    <p className="error-text">{historyError}</p>
                  ) : events.length === 0 ? (
                    <p className="muted-text">Ainda não há eventos registrados para este chamado.</p>
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

              {/* Tasks */}
              <div className="section-heading-row">
                <h2 className="section-heading">Tarefas ({tasks.length})</h2>
              </div>

              {selectedTaskId ? (
                <div className="task-detail-shell">
                  <TaskDetailView
                    taskId={selectedTaskId}
                    session={session}
                    availableTasks={tasks}
                    onUnauthorized={onUnauthorized}
                    onChanged={() => {
                      if (selectedDemandId) {
                        void loadDemandDetail(selectedDemandId, true);
                      }
                    }}
                    onBack={() => setSelectedTaskId(null)}
                  />
                </div>
              ) : tasks.length === 0 ? (
                <div className="empty-state">
                  {isAdmin ? (
                    <>
                      <p className="empty-title">Nenhuma tarefa criada neste chamado ainda.</p>
                      <p className="empty-description">Distribua o trabalho criando a primeira tarefa.</p>
                      {hasDemandsWrite && demand?.status === 'open' && (
                        <button type="button" className="primary-button" onClick={openCreateTask}>
                          + Nova tarefa
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="empty-title">Você ainda não tem tarefas neste chamado.</p>
                      <p className="empty-description">Quando o responsável atribuir trabalho a você, ele aparecerá aqui.</p>
                    </>
                  )}
                </div>
              ) : (
                <ul className="task-list">
                  {tasks.map((task) => (
                    <li key={task.id} className="task-list-item">
                      <div className="task-item-main">
                        <div className="task-item-title">
                          {task.title}
                          <span className={`task-badge status-${task.status}`}>{taskStatusLabel(task.status)}</span>
                          <span className={`priority-badge ${task.priority}`}>{priorityLabels[task.priority]}</span>
                        </div>
                        <div className="task-item-meta">
                          {isAdmin && hasUsersRead && (
                            <span>Responsável: <strong>{userName(task.assignedToUserId)}</strong></span>
                          )}
                          {isAdmin && <span className="muted-dash">•</span>}
                          <span>Entrega: <strong>{task.deliveryDate}</strong></span>
                          {task.acceptedAt && <span className="muted-dash">• Aceite registrado</span>}
                        </div>
                      </div>
                      <div className="action-buttons">
                        <button
                          type="button"
                          className="action-btn edit"
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          Abrir detalhes
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
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
    </section>
  );
}
