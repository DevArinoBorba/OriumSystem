import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { api, ApiError } from '../api.js';
import type {
  ClientTimelineEvent,
  CreateMaterialInput,
  Material,
  MaterialCategory,
  MaterialFormState,
  MaterialHistoryEvent,
  MaterialNavigationTarget,
  MaterialsFilterCategory,
  MaterialsFilterStatus,
  MaterialTarget,
  SessionResponse,
  TimelineEventSource,
  UpdateMaterialInput,
} from '../types.js';

interface MaterialsViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  initialTarget?: MaterialNavigationTarget;
  onTargetConsumed?: () => void;
  onOpenDemand?: (demandId: string, taskId?: string | null) => void;
}

const TIMELINE_ACTION_LABELS: Record<string, string> = {
  // Chamado (demand)
  demand_created: 'Chamado criado',
  demand_updated: 'Chamado atualizado',
  demand_completed: 'Chamado concluído',
  // Tarefa (task)
  task_created: 'Tarefa criada',
  task_accepted: 'Tarefa aceita',
  task_started: 'Tarefa iniciada',
  task_review_submitted: 'Revisão enviada',
  task_changes_requested: 'Ajustes solicitados',
  task_completed: 'Tarefa concluída',
  task_ready: 'Tarefa pronta',
  task_pause_requested: 'Pausa solicitada',
  task_pause_approved: 'Pausa aprovada',
  task_resumed: 'Tarefa retomada',
  task_reassigned: 'Tarefa reatribuída',
  task_requirement_updated: 'Requisito atualizado',
  task_dependency_added: 'Dependência adicionada',
  task_dependency_removed: 'Dependência removida',
  task_comment_created: 'Comentário adicionado',
  // Material
  material_created: 'Material criado',
  material_updated: 'Material atualizado',
  material_archived: 'Material arquivado',
  material_restored: 'Material restaurado',
  // Fallbacks genéricos
  create: 'Criado',
  update: 'Atualizado',
  archive: 'Arquivado',
  restore: 'Restaurado',
};

const TIMELINE_SOURCE_LABELS: Record<TimelineEventSource, string> = {
  demand: 'Chamado',
  task: 'Tarefa',
  material: 'Material',
};

function formatTimelineAction(action: string): string {
  if (TIMELINE_ACTION_LABELS[action]) {
    return TIMELINE_ACTION_LABELS[action];
  }
  const clean = action.replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  brand: 'Identidade visual',
  preview: 'Prévia de entrega',
  published: 'Site publicado',
  drive: 'Google Drive',
  asset: 'Arquivo / Asset',
  reference: 'Referência externa',
};

const CATEGORIES: MaterialCategory[] = [
  'brand',
  'preview',
  'published',
  'drive',
  'asset',
  'reference',
];

const emptyFormState: MaterialFormState = {
  title: '',
  description: '',
  url: '',
  category: 'reference',
  clientId: '',
  demandId: '',
  taskId: '',
};

function formatCuiabaDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Cuiaba',
    }).format(d);
  } catch {
    return isoString;
  }
}

function isValidHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function MaterialsView({
  session,
  onUnauthorized,
  initialTarget,
  onTargetConsumed,
  onOpenDemand,
}: MaterialsViewProps) {
  const isAdmin = session.roles.includes('administrator');
  const hasWrite = session.permissions.includes('materials.write');
  const hasArchive = session.permissions.includes('materials.archive');
  const hasDemandsRead = session.permissions.includes('demands.read');
  const canViewTimeline = session.permissions.includes('materials.read') && hasDemandsRead;

  // List and filter state
  const [materials, setMaterials] = useState<Material[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<MaterialsFilterCategory>('all');
  const [statusFilter, setStatusFilter] = useState<MaterialsFilterStatus>('active');
  const [selectedClientId, setSelectedClientId] = useState<string>(initialTarget?.clientId || '');
  const [selectedDemandId, setSelectedDemandId] = useState<string>(initialTarget?.demandId || '');
  const [selectedTaskId, setSelectedTaskId] = useState<string>(initialTarget?.taskId || '');

  // Client Timeline state
  const [timelineEvents, setTimelineEvents] = useState<ClientTimelineEvent[]>([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelinePage, setTimelinePage] = useState(1);
  const timelinePageSize = 10;
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineClientName, setTimelineClientName] = useState<string>('');
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const timelineControllerRef = useRef<AbortController | null>(null);
  const activeTimelineClientIdRef = useRef<string>('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Form panel state
  const [formOpen, setFormOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [formState, setFormState] = useState<MaterialFormState>(emptyFormState);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const formPanelRef = useRef<HTMLElement>(null);
  const isSubmittingRef = useRef(false);

  // Target selectors state for form & filters with real search, pagination & error handling
  const [clientTargets, setClientTargets] = useState<MaterialTarget[]>([]);
  const [clientTargetsTotal, setClientTargetsTotal] = useState(0);
  const [clientTargetsPage, setClientTargetsPage] = useState(1);
  const [clientSearch, setClientSearch] = useState('');
  const [clientTargetsLoading, setClientTargetsLoading] = useState(false);
  const [clientTargetsError, setClientTargetsError] = useState<string | null>(null);
  const clientControllerRef = useRef<AbortController | null>(null);

  const [demandTargets, setDemandTargets] = useState<MaterialTarget[]>([]);
  const [demandTargetsTotal, setDemandTargetsTotal] = useState(0);
  const [demandTargetsPage, setDemandTargetsPage] = useState(1);
  const [demandSearch, setDemandSearch] = useState('');
  const [demandTargetsLoading, setDemandTargetsLoading] = useState(false);
  const [demandTargetsError, setDemandTargetsError] = useState<string | null>(null);
  const demandControllerRef = useRef<AbortController | null>(null);
  const activeClientIdRef = useRef<string>('');

  const [taskTargets, setTaskTargets] = useState<MaterialTarget[]>([]);
  const [taskTargetsTotal, setTaskTargetsTotal] = useState(0);
  const [taskTargetsPage, setTaskTargetsPage] = useState(1);
  const [taskSearch, setTaskSearch] = useState('');
  const [taskTargetsLoading, setTaskTargetsLoading] = useState(false);
  const [taskTargetsError, setTaskTargetsError] = useState<string | null>(null);
  const taskControllerRef = useRef<AbortController | null>(null);
  const activeDemandIdRef = useRef<string>('');

  // Main controllers refs
  const materialsControllerRef = useRef<AbortController | null>(null);
  const historyControllerRef = useRef<AbortController | null>(null);

  // History drawer / modal state
  const [historyMaterial, setHistoryMaterial] = useState<Material | null>(null);
  const [historyEvents, setHistoryEvents] = useState<MaterialHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyDialogRef = useRef<HTMLDialogElement>(null);

  // Archive dialog state
  const [materialToArchive, setMaterialToArchive] = useState<Material | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archiveDialogRef = useRef<HTMLDialogElement>(null);

  // Consume initialTarget once
  useEffect(() => {
    if (initialTarget && onTargetConsumed) {
      if (initialTarget.clientId) setSelectedClientId(initialTarget.clientId);
      if (initialTarget.demandId) setSelectedDemandId(initialTarget.demandId);
      if (initialTarget.taskId) setSelectedTaskId(initialTarget.taskId);
      onTargetConsumed();
    }
  }, [initialTarget, onTargetConsumed]);

  // Cleanup on unmount: abort all active controllers
  useEffect(() => {
    return () => {
      clientControllerRef.current?.abort();
      demandControllerRef.current?.abort();
      taskControllerRef.current?.abort();
      materialsControllerRef.current?.abort();
      historyControllerRef.current?.abort();
      timelineControllerRef.current?.abort();
    };
  }, []);

  // Load clients with search, pagination and error handling
  const loadClientTargets = useCallback(
    async (query = '', pageNum = 1) => {
      clientControllerRef.current?.abort();
      const controller = new AbortController();
      clientControllerRef.current = controller;

      setClientTargetsLoading(true);
      setClientTargetsError(null);

      try {
        const res = await api.getMaterialTargets(
          {
            kind: 'client',
            q: query.trim() || undefined,
            page: pageNum,
            pageSize: 20,
          },
          controller.signal,
          onUnauthorized,
        );
        if (controller.signal.aborted) return;
        setClientTargets(res.targets);
        setClientTargetsTotal(res.total);
        setClientTargetsPage(res.page);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 403) {
          setClientTargets([]);
          setClientTargetsTotal(0);
          setClientTargetsError('Sem permissão para listar clientes.');
        } else {
          setClientTargetsError('Não foi possível carregar os clientes.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setClientTargetsLoading(false);
        }
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void loadClientTargets();
  }, [loadClientTargets]);

  // Load demands when clientId changes with search, pagination, error and AbortController guard
  const loadDemandTargets = useCallback(
    async (clientId: string, query = '', pageNum = 1) => {
      demandControllerRef.current?.abort();
      activeClientIdRef.current = clientId;

      if (!clientId) {
        setDemandTargets([]);
        setDemandTargetsTotal(0);
        setDemandTargetsPage(1);
        setDemandTargetsError(null);
        setDemandTargetsLoading(false);
        return;
      }

      const controller = new AbortController();
      demandControllerRef.current = controller;

      setDemandTargetsLoading(true);
      setDemandTargetsError(null);

      try {
        const res = await api.getMaterialTargets(
          {
            kind: 'demand',
            clientId,
            q: query.trim() || undefined,
            page: pageNum,
            pageSize: 20,
          },
          controller.signal,
          onUnauthorized,
        );
        if (controller.signal.aborted || activeClientIdRef.current !== clientId) return;
        setDemandTargets(res.targets);
        setDemandTargetsTotal(res.total);
        setDemandTargetsPage(res.page);
      } catch (err) {
        if (controller.signal.aborted || activeClientIdRef.current !== clientId) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 403) {
          setDemandTargets([]);
          setDemandTargetsTotal(0);
          setDemandTargetsError('Sem permissão para listar chamados.');
        } else {
          setDemandTargetsError('Não foi possível carregar os chamados.');
        }
      } finally {
        if (!controller.signal.aborted && activeClientIdRef.current === clientId) {
          setDemandTargetsLoading(false);
        }
      }
    },
    [onUnauthorized],
  );

  // Load tasks when demandId changes with search, pagination, error and AbortController guard
  const loadTaskTargets = useCallback(
    async (demandId: string, query = '', pageNum = 1) => {
      taskControllerRef.current?.abort();
      activeDemandIdRef.current = demandId;

      if (!demandId) {
        setTaskTargets([]);
        setTaskTargetsTotal(0);
        setTaskTargetsPage(1);
        setTaskTargetsError(null);
        setTaskTargetsLoading(false);
        return;
      }

      const controller = new AbortController();
      taskControllerRef.current = controller;

      setTaskTargetsLoading(true);
      setTaskTargetsError(null);

      try {
        const res = await api.getMaterialTargets(
          {
            kind: 'task',
            demandId,
            q: query.trim() || undefined,
            page: pageNum,
            pageSize: 20,
          },
          controller.signal,
          onUnauthorized,
        );
        if (controller.signal.aborted || activeDemandIdRef.current !== demandId) return;
        setTaskTargets(res.targets);
        setTaskTargetsTotal(res.total);
        setTaskTargetsPage(res.page);
      } catch (err) {
        if (controller.signal.aborted || activeDemandIdRef.current !== demandId) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 403) {
          setTaskTargets([]);
          setTaskTargetsTotal(0);
          setTaskTargetsError('Sem permissão para listar tarefas.');
        } else {
          setTaskTargetsError('Não foi possível carregar as tarefas.');
        }
      } finally {
        if (!controller.signal.aborted && activeDemandIdRef.current === demandId) {
          setTaskTargetsLoading(false);
        }
      }
    },
    [onUnauthorized],
  );

  // Computations for paginated targets
  const clientTotalPages = Math.max(1, Math.ceil(clientTargetsTotal / 20));
  const demandTotalPages = Math.max(1, Math.ceil(demandTargetsTotal / 20));
  const taskTotalPages = Math.max(1, Math.ceil(taskTargetsTotal / 20));

  // Preserve selected items in options even if outside active search page
  const formClientOptions = useMemo<MaterialTarget[]>(() => {
    const list = [...clientTargets];
    if (formState.clientId && !list.some((c) => c.id === formState.clientId)) {
      list.unshift({ id: formState.clientId, title: 'Cliente selecionado' });
    }
    return list;
  }, [clientTargets, formState.clientId]);

  const formDemandOptions = useMemo<MaterialTarget[]>(() => {
    const list = [...demandTargets];
    if (formState.demandId && !list.some((d) => d.id === formState.demandId)) {
      list.unshift({ id: formState.demandId, title: 'Chamado selecionado' });
    }
    return list;
  }, [demandTargets, formState.demandId]);

  const formTaskOptions = useMemo<MaterialTarget[]>(() => {
    const list = [...taskTargets];
    if (formState.taskId && !list.some((t) => t.id === formState.taskId)) {
      list.unshift({ id: formState.taskId, title: 'Tarefa selecionada' });
    }
    return list;
  }, [taskTargets, formState.taskId]);

  const filterClientOptions = useMemo<MaterialTarget[]>(() => {
    const list = [...clientTargets];
    if (selectedClientId && !list.some((c) => c.id === selectedClientId)) {
      list.unshift({ id: selectedClientId, title: 'Cliente filtrado' });
    }
    return list;
  }, [clientTargets, selectedClientId]);

  // Main materials loader with AbortController and full 403 data wipe
  const loadMaterials = useCallback(
    async (
      pageNum: number,
      status: MaterialsFilterStatus,
      category: MaterialsFilterCategory,
      clientId: string,
      demandId: string,
      taskId: string,
      queryText: string,
    ) => {
      materialsControllerRef.current?.abort();
      const controller = new AbortController();
      materialsControllerRef.current = controller;

      setLoading(true);
      setListError(null);

      try {
        const res = await api.getMaterials(
          {
            page: pageNum,
            pageSize,
            status,
            category: category !== 'all' ? category : undefined,
            clientId: clientId || undefined,
            demandId: demandId || undefined,
            taskId: taskId || undefined,
            q: queryText.trim() || undefined,
          },
          controller.signal,
          onUnauthorized,
        );
        if (controller.signal.aborted) return;
        setMaterials(res.materials);
        setTotal(res.total);
        setPage(res.page);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 403) {
          // 403 limpa dados/rótulos/targets conforme requisito de segurança
          setListError('Acesso não autorizado: você não possui permissão para visualizar materiais (materials.read).');
          setMaterials([]);
          setTotal(0);
          setClientTargets([]);
          setClientTargetsTotal(0);
          setDemandTargets([]);
          setDemandTargetsTotal(0);
          setTaskTargets([]);
          setTaskTargetsTotal(0);
          setSelectedClientId('');
          setSelectedDemandId('');
          setSelectedTaskId('');
          setHistoryMaterial(null);
          setHistoryEvents([]);
          setFormOpen(false);
          setEditingMaterial(null);
          setTimelineEvents([]);
          setTimelineTotal(0);
          setTimelinePage(1);
          setTimelineError(null);
          setTimelineLoading(false);
          setTimelineClientName('');
        } else {
          setListError('Não foi possível carregar a lista de materiais. Tente novamente.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [onUnauthorized, pageSize],
  );

  useEffect(() => {
    void loadMaterials(
      page,
      statusFilter,
      categoryFilter,
      selectedClientId,
      selectedDemandId,
      selectedTaskId,
      appliedSearch,
    );
  }, [
    page,
    statusFilter,
    categoryFilter,
    selectedClientId,
    selectedDemandId,
    selectedTaskId,
    appliedSearch,
    loadMaterials,
  ]);

  // Client Timeline loader with AbortController, generation guard & safe error recovery
  const loadTimeline = useCallback(
    async (clientId: string, pageNum = 1) => {
      if (!clientId || !canViewTimeline) {
        timelineControllerRef.current?.abort();
        setTimelineEvents([]);
        setTimelineTotal(0);
        setTimelinePage(1);
        setTimelineError(null);
        setTimelineLoading(false);
        setTimelineClientName('');
        return;
      }

      timelineControllerRef.current?.abort();
      const controller = new AbortController();
      timelineControllerRef.current = controller;
      activeTimelineClientIdRef.current = clientId;

      // Limpar rótulo anterior e definir página alvo para evitar exibição de cliente antigo enquanto carrega
      setTimelineClientName('');
      setTimelinePage(pageNum);
      setTimelineLoading(true);
      setTimelineError(null);

      try {
        const res = await api.getClientTimeline(
          clientId,
          { page: pageNum, pageSize: timelinePageSize },
          controller.signal,
          onUnauthorized,
        );

        // Guarda de identidade estrita controller === timelineControllerRef.current E sinal ativo
        if (timelineControllerRef.current !== controller || controller.signal.aborted) {
          return;
        }

        setTimelineEvents(res.events);
        setTimelineTotal(res.total);
        setTimelinePage(res.page);
        setTimelineClientName(res.client.name);
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        if (timelineControllerRef.current !== controller) {
          return;
        }

        if (err instanceof ApiError) {
          if (err.status === 403) {
            setTimelineEvents([]);
            setTimelineTotal(0);
            setTimelinePage(1);
            setTimelineClientName('');
            setTimelineError('Acesso não autorizado para visualizar a linha do tempo deste cliente.');
            return;
          }
          if (err.status === 404) {
            setTimelineEvents([]);
            setTimelineTotal(0);
            setTimelinePage(1);
            setTimelineClientName('');
            setTimelineError('Cliente não encontrado ou você não possui tarefas atribuídas a este cliente.');
            return;
          }
        }
        setTimelineError('Não foi possível carregar a linha do tempo do cliente. Verifique a conexão e tente novamente.');
      } finally {
        // Apenas a requisição ativa desliga o estado de carregamento, evitando desligamento prematuro por request abortada
        if (timelineControllerRef.current === controller && !controller.signal.aborted) {
          setTimelineLoading(false);
        }
      }
    },
    [canViewTimeline, onUnauthorized, timelinePageSize],
  );

  useEffect(() => {
    if (selectedClientId && canViewTimeline) {
      void loadTimeline(selectedClientId, 1);
    } else {
      timelineControllerRef.current?.abort();
      setTimelineEvents([]);
      setTimelineTotal(0);
      setTimelinePage(1);
      setTimelineError(null);
      setTimelineLoading(false);
      setTimelineClientName('');
    }
  }, [selectedClientId, canViewTimeline, loadTimeline]);

  // Search submission
  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchQuery.trim());
  }

  function handleClearSearch() {
    setSearchQuery('');
    setAppliedSearch('');
    setPage(1);
  }

  function handleClearAllFilters() {
    setSearchQuery('');
    setAppliedSearch('');
    setCategoryFilter('all');
    setStatusFilter('active');
    setSelectedClientId('');
    setSelectedDemandId('');
    setSelectedTaskId('');
    setPage(1);
  }

  // Open Create Form
  function openCreateForm() {
    setEditingMaterial(null);
    setClientSearch('');
    setClientTargetsPage(1);
    setDemandSearch('');
    setDemandTargetsPage(1);
    setTaskSearch('');
    setTaskTargetsPage(1);
    const initialClientId = selectedClientId || clientTargets[0]?.id || '';
    setFormState({
      ...emptyFormState,
      clientId: initialClientId,
    });
    if (initialClientId) {
      void loadDemandTargets(initialClientId);
    }
    setFormError(null);
    setVersionConflict(false);
    setFormOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }

  // Open Edit Form
  function openEditForm(material: Material) {
    setEditingMaterial(material);
    setFormState({
      id: material.id,
      version: material.version,
      title: material.title,
      description: material.description || '',
      url: material.url,
      category: material.category,
      clientId: material.clientId,
      demandId: material.demandId || '',
      taskId: material.taskId || '',
    });
    setFormError(null);
    setVersionConflict(false);
    setFormOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }

  // Duplicate reference as a new material (fresh ID, fresh history, customizable bindings)
  function handleDuplicate(material: Material) {
    setEditingMaterial(null);
    setClientSearch('');
    setClientTargetsPage(1);
    setDemandSearch('');
    setDemandTargetsPage(1);
    setTaskSearch('');
    setTaskTargetsPage(1);
    const initialClientId = selectedClientId || clientTargets[0]?.id || material.clientId || '';
    setFormState({
      ...emptyFormState,
      title: `${material.title} (cópia)`,
      description: material.description || '',
      url: material.url,
      category: material.category,
      clientId: initialClientId,
      demandId: selectedDemandId || '',
      taskId: selectedTaskId || '',
    });
    if (initialClientId) {
      void loadDemandTargets(initialClientId);
    }
    setFormError(null);
    setVersionConflict(false);
    setFormOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }

  function closeForm() {
    if (formBusy) return;
    clientControllerRef.current?.abort();
    demandControllerRef.current?.abort();
    taskControllerRef.current?.abort();
    setClientSearch('');
    setClientTargetsPage(1);
    setDemandSearch('');
    setDemandTargetsPage(1);
    setTaskSearch('');
    setTaskTargetsPage(1);
    setFormOpen(false);
    setEditingMaterial(null);
    setFormState(emptyFormState);
    setFormError(null);
    setVersionConflict(false);
  }

  // Handle Form Submission with Validation and Optimistic Concurrency
  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    // Client-side validations
    const trimmedTitle = formState.title.trim();
    if (!trimmedTitle) {
      setFormError('O título do material é obrigatório.');
      titleInputRef.current?.focus();
      return;
    }
    if (trimmedTitle.length > 200) {
      setFormError('O título deve ter no máximo 200 caracteres.');
      titleInputRef.current?.focus();
      return;
    }

    const trimmedUrl = formState.url.trim();
    if (!trimmedUrl) {
      setFormError('A URL do material é obrigatória.');
      return;
    }
    if (!isValidHttpUrl(trimmedUrl)) {
      setFormError('Informe uma URL válida iniciando com http:// ou https://, sem credenciais de usuário.');
      return;
    }

    if (!formState.clientId) {
      setFormError('O cliente deve ser selecionado.');
      return;
    }

    // Regra do responsável: Colaborador exige ao menos chamado próprio
    if (!isAdmin && !editingMaterial && !formState.demandId) {
      setFormError('Colaboradores devem vincular materiais a um chamado de seu trabalho.');
      return;
    }

    isSubmittingRef.current = true;
    setFormBusy(true);
    setFormError(null);
    setVersionConflict(false);

    const controller = new AbortController();

    try {
      if (editingMaterial) {
        // Conforme contrato de segurança revisado pelo Codex:
        // clientId, demandId e taskId são estritamente IMUTÁVEIS para ambos os papéis após a criação.
        // O PATCH envia apenas os campos editáveis: title, description, category, url + version.
        const payload: UpdateMaterialInput = {
          version: editingMaterial.version,
          title: trimmedTitle,
          description: formState.description.trim(),
          url: trimmedUrl,
          category: formState.category,
        };

        const { material: updated } = await api.updateMaterial(
          editingMaterial.id,
          payload,
          controller.signal,
          onUnauthorized,
        );

        setNoticeMessage(`Material "${updated.title}" atualizado com sucesso!`);
        closeForm();
        void loadMaterials(
          page,
          statusFilter,
          categoryFilter,
          selectedClientId,
          selectedDemandId,
          selectedTaskId,
          appliedSearch,
        );
      } else {
        // Criação de novo material
        const payload: CreateMaterialInput = {
          title: trimmedTitle,
          description: formState.description.trim(),
          url: trimmedUrl,
          category: formState.category,
          clientId: formState.clientId,
          demandId: formState.demandId || undefined,
          taskId: formState.taskId || undefined,
        };

        const { material: created } = await api.createMaterial(
          payload,
          controller.signal,
          onUnauthorized,
        );

        setNoticeMessage(`Material "${created.title}" cadastrado com sucesso!`);
        closeForm();
        setPage(1);
        void loadMaterials(
          1,
          statusFilter,
          categoryFilter,
          selectedClientId,
          selectedDemandId,
          selectedTaskId,
          appliedSearch,
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === 'MATERIAL_VERSION_CONFLICT') {
          setVersionConflict(true);
          setFormError(
            'Conflito de versão: este material foi alterado por outro usuário ou processo enquanto você editava.',
          );
        } else if (err.status === 403) {
          setFormError('Ação não autorizada. Verifique suas permissões operacionais.');
          setMaterials([]);
          setTotal(0);
          setClientTargets([]);
          setClientTargetsTotal(0);
          setDemandTargets([]);
          setDemandTargetsTotal(0);
          setTaskTargets([]);
          setTaskTargetsTotal(0);
        } else if (err.status === 400) {
          setFormError(err.message || 'Dados inválidos fornecidos para o material.');
        } else {
          setFormError(err.message || 'Não foi possível salvar o material. Tente novamente.');
        }
      } else {
        setFormError('Erro inesperado de comunicação com o servidor.');
      }
    } finally {
      isSubmittingRef.current = false;
      setFormBusy(false);
    }
  }

  // Reload latest version after 409 conflict
  async function reloadLatestVersion() {
    if (!editingMaterial) return;
    setFormBusy(true);
    setFormError(null);
    const controller = new AbortController();

    try {
      const { material: latest } = await api.getMaterial(
        editingMaterial.id,
        controller.signal,
        onUnauthorized,
      );
      setEditingMaterial(latest);
      setFormState({
        id: latest.id,
        version: latest.version,
        title: latest.title,
        description: latest.description || '',
        url: latest.url,
        category: latest.category,
        clientId: latest.clientId,
        demandId: latest.demandId || '',
        taskId: latest.taskId || '',
      });
      setVersionConflict(false);
      setNoticeMessage(`Versão mais recente (v${latest.version}) carregada do servidor. Rascunho descartado.`);
    } catch {
      setFormError('Não foi possível obter a versão mais recente do material.');
    } finally {
      setFormBusy(false);
    }
  }

  // Open History Drawer / Dialog
  async function openHistory(material: Material) {
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;

    setHistoryMaterial(material);
    setHistoryEvents([]);
    setHistoryError(null);
    setHistoryLoading(true);
    historyDialogRef.current?.showModal();

    try {
      const res = await api.getMaterialHistory(
        material.id,
        { page: 1, pageSize: 50 },
        controller.signal,
        onUnauthorized,
      );
      if (controller.signal.aborted) return;
      setHistoryEvents(res.events);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 403) {
        setHistoryError('Acesso não autorizado para visualizar histórico deste material.');
      } else {
        setHistoryError('Não foi possível carregar o histórico de alterações deste material.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setHistoryLoading(false);
      }
    }
  }

  function closeHistory() {
    historyControllerRef.current?.abort();
    historyControllerRef.current = null;
    historyDialogRef.current?.close();
    setHistoryMaterial(null);
    setHistoryEvents([]);
    setHistoryError(null);
  }

  // Archive / Restore
  function openArchiveConfirm(material: Material) {
    setMaterialToArchive(material);
    setArchiveError(null);
    archiveDialogRef.current?.showModal();
  }

  function closeArchiveConfirm() {
    if (archiveBusy) return;
    setMaterialToArchive(null);
    setArchiveError(null);
    archiveDialogRef.current?.close();
  }

  async function handleConfirmArchive() {
    if (!materialToArchive || archiveBusy) return;
    setArchiveBusy(true);
    setArchiveError(null);
    const controller = new AbortController();

    try {
      const { material: archived } = await api.archiveMaterial(
        materialToArchive.id,
        materialToArchive.version,
        controller.signal,
        onUnauthorized,
      );
      setNoticeMessage(`Material "${archived.title}" arquivado com sucesso.`);
      closeArchiveConfirm();
      void loadMaterials(
        page,
        statusFilter,
        categoryFilter,
        selectedClientId,
        selectedDemandId,
        selectedTaskId,
        appliedSearch,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === 'MATERIAL_VERSION_CONFLICT') {
          setArchiveError('Este material foi modificado recentemente. Feche esta caixa e recarregue a lista.');
        } else if (err.status === 403) {
          setMaterials([]);
          setTotal(0);
          setArchiveError('Permissão revogada: você não possui acesso para arquivar materiais.');
        } else {
          setArchiveError(err.message || 'Não foi possível arquivar o material.');
        }
      } else {
        setArchiveError('Não foi possível arquivar o material.');
      }
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleRestore(material: Material) {
    if (archiveBusy) return;
    setArchiveBusy(true);
    const controller = new AbortController();

    try {
      const { material: restored } = await api.restoreMaterial(
        material.id,
        material.version,
        controller.signal,
        onUnauthorized,
      );
      setNoticeMessage(`Material "${restored.title}" restaurado com sucesso.`);
      void loadMaterials(
        page,
        statusFilter,
        categoryFilter,
        selectedClientId,
        selectedDemandId,
        selectedTaskId,
        appliedSearch,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === 'MATERIAL_VERSION_CONFLICT') {
          setNoticeMessage('Este material foi modificado recentemente. A lista foi atualizada.');
          void loadMaterials(
            page,
            statusFilter,
            categoryFilter,
            selectedClientId,
            selectedDemandId,
            selectedTaskId,
            appliedSearch,
          );
        } else if (err.status === 403) {
          setMaterials([]);
          setTotal(0);
          setNoticeMessage('Permissão revogada: você não possui acesso para restaurar materiais.');
        } else {
          setNoticeMessage(err.message || 'Não foi possível restaurar o material.');
        }
      } else {
        setNoticeMessage('Não foi possível restaurar o material.');
      }
    } finally {
      setArchiveBusy(false);
    }
  }

  // Keyboard Escape handler for inline panel
  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && formOpen && !formBusy) {
      event.preventDefault();
      closeForm();
    }
  }

  const hasActiveFilters =
    Boolean(appliedSearch) ||
    categoryFilter !== 'all' ||
    statusFilter !== 'active' ||
    Boolean(selectedClientId) ||
    Boolean(selectedDemandId) ||
    Boolean(selectedTaskId);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section
      className="view-panel materials-view"
      aria-labelledby="materials-heading"
      onKeyDown={handlePanelKeyDown}
    >
      <div className="panel-header">
        <div>
          <h1 id="materials-heading">Materiais</h1>
          <p className="panel-subtitle">
            Referências externas, links de produção, prévias e materiais vinculados a clientes, chamados e tarefas.
          </p>
        </div>
        <div className="panel-actions">
          {hasWrite && (
            <button
              type="button"
              className="primary-button"
              onClick={openCreateForm}
              disabled={formOpen}
            >
              Novo material
            </button>
          )}
        </div>
      </div>

      {noticeMessage && (
        <div className="alert-banner success" role="status">
          <span>{noticeMessage}</span>
          <button
            type="button"
            className="close-alert"
            onClick={() => setNoticeMessage(null)}
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {listError && (
        <div className="alert-banner error" role="alert">
          <span>{listError}</span>
          <button
            type="button"
            className="secondary-button small"
            onClick={() =>
              void loadMaterials(
                page,
                statusFilter,
                categoryFilter,
                selectedClientId,
                selectedDemandId,
                selectedTaskId,
                appliedSearch,
              )
            }
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Inline Create / Edit Form Panel */}
      {formOpen && (
        <section
          ref={formPanelRef}
          className="inline-panel material-form-panel"
          aria-labelledby="material-form-title"
        >
          <div className="panel-header">
            <h2 id="material-form-title">
              {editingMaterial ? `Editar material (v${editingMaterial.version})` : 'Novo material'}
            </h2>
            <button
              type="button"
              className="close-button"
              onClick={closeForm}
              aria-label="Fechar formulário"
              disabled={formBusy}
            >
              ✕
            </button>
          </div>

          <form onSubmit={(e) => void handleFormSubmit(e)} noValidate>
            {formError && (
              <div className="alert-banner error" role="alert">
                <span>{formError}</span>
                {versionConflict && (
                  <div className="conflict-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="primary-button small"
                      onClick={() => void reloadLatestVersion()}
                      disabled={formBusy}
                    >
                      Descartar rascunho e carregar dados do servidor
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="material-title">Título *</label>
                <input
                  ref={titleInputRef}
                  id="material-title"
                  type="text"
                  required
                  maxLength={200}
                  value={formState.title}
                  onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                  placeholder="Ex: Identidade visual e logotipo em alta resolução"
                  disabled={formBusy}
                />
              </div>

              <div className="form-group">
                <label htmlFor="material-category">Categoria *</label>
                <select
                  id="material-category"
                  value={formState.category}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      category: e.target.value as MaterialCategory,
                    })
                  }
                  disabled={formBusy}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group full-width">
                <label htmlFor="material-url">URL Externa * (somente http:// ou https://)</label>
                <input
                  id="material-url"
                  type="url"
                  required
                  maxLength={2048}
                  value={formState.url}
                  onChange={(e) => setFormState({ ...formState, url: e.target.value })}
                  placeholder="https://drive.google.com/..."
                  disabled={formBusy}
                />
                <span className="helper-text">
                  Não utilize credenciais de acesso embutidas na URL.
                </span>
              </div>

              <div className="form-group full-width">
                <label htmlFor="material-description">Descrição (opcional)</label>
                <textarea
                  id="material-description"
                  rows={3}
                  maxLength={4000}
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  placeholder="Notas, instruções de uso ou contexto do material..."
                  disabled={formBusy}
                />
              </div>

              {/* Vínculos: imutáveis na edição; seletores controlados na criação */}
              {editingMaterial ? (
                <div className="form-group full-width immutable-links-box">
                  <span className="box-title">Vínculos Operacionais (Imutáveis após a criação)</span>
                  <div className="links-summary">
                    <span className="badge badge-low">
                      Cliente: {editingMaterial.client.name}
                    </span>
                    {editingMaterial.demand && (
                      <span className="badge badge-normal">
                        Chamado: {editingMaterial.demand.title}
                      </span>
                    )}
                    {editingMaterial.task && (
                      <span className="badge badge-normal">
                        Tarefa: {editingMaterial.task.title}
                      </span>
                    )}
                  </div>
                  <p className="muted-text" style={{ fontSize: '0.8rem', margin: '8px 0 0 0' }}>
                    Para associar este material a outro trabalho,{' '}
                    <button
                      type="button"
                      className="text-button"
                      style={{ padding: 0, textDecoration: 'underline', font: 'inherit', color: 'var(--color-primary)' }}
                      onClick={() => handleDuplicate(editingMaterial)}
                    >
                      duplique a referência em um novo cadastro
                    </button>{' '}
                    (preserva o histórico isolado).
                  </p>
                </div>
              ) : (
                <>
                  <div className="form-group target-selector-box">
                    <label htmlFor="material-client">Cliente *</label>
                    <div className="target-search-row">
                      <input
                        type="search"
                        className="target-search-input"
                        placeholder="Buscar cliente por nome..."
                        aria-label="Buscar cliente"
                        value={clientSearch}
                        onChange={(e) => {
                          const val = e.target.value;
                          setClientSearch(val);
                          setClientTargetsPage(1);
                          void loadClientTargets(val, 1);
                        }}
                        disabled={formBusy}
                      />
                    </div>
                    {clientTargetsError && (
                      <div className="target-error-inline" role="alert">
                        <span>{clientTargetsError}</span>
                        <button
                          type="button"
                          className="secondary-button small"
                          onClick={() => void loadClientTargets(clientSearch, clientTargetsPage)}
                          disabled={clientTargetsLoading}
                        >
                          Tentar novamente
                        </button>
                      </div>
                    )}
                    <select
                      id="material-client"
                      required
                      value={formState.clientId}
                      onChange={(e) => {
                        const newClientId = e.target.value;
                        setFormState({
                          ...formState,
                          clientId: newClientId,
                          demandId: '',
                          taskId: '',
                        });
                        if (newClientId) {
                          void loadDemandTargets(newClientId, '', 1);
                        } else {
                          setDemandTargets([]);
                          setDemandTargetsTotal(0);
                          setTaskTargets([]);
                          setTaskTargetsTotal(0);
                        }
                      }}
                      disabled={formBusy || clientTargetsLoading}
                    >
                      <option value="">Selecione um cliente...</option>
                      {formClientOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    {clientTotalPages > 1 && (
                      <div className="target-pagination-inline">
                        <button
                          type="button"
                          className="secondary-button small"
                          disabled={clientTargetsPage <= 1 || clientTargetsLoading}
                          onClick={() => {
                            const prev = clientTargetsPage - 1;
                            setClientTargetsPage(prev);
                            void loadClientTargets(clientSearch, prev);
                          }}
                        >
                          ‹ Anterior
                        </button>
                        <span className="target-page-text">
                          Página {clientTargetsPage} de {clientTotalPages} ({clientTargetsTotal} clientes)
                        </span>
                        <button
                          type="button"
                          className="secondary-button small"
                          disabled={clientTargetsPage >= clientTotalPages || clientTargetsLoading}
                          onClick={() => {
                            const next = clientTargetsPage + 1;
                            setClientTargetsPage(next);
                            void loadClientTargets(clientSearch, next);
                          }}
                        >
                          Próxima ›
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="form-group target-selector-box">
                    <label htmlFor="material-demand">
                      Chamado {isAdmin ? '(opcional para admin)' : '* (obrigatório)'}
                    </label>
                    {formState.clientId && (
                      <div className="target-search-row">
                        <input
                          type="search"
                          className="target-search-input"
                          placeholder="Buscar chamado..."
                          aria-label="Buscar chamado"
                          value={demandSearch}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDemandSearch(val);
                            setDemandTargetsPage(1);
                            void loadDemandTargets(formState.clientId, val, 1);
                          }}
                          disabled={formBusy || demandTargetsLoading}
                        />
                      </div>
                    )}
                    {demandTargetsError && (
                      <div className="target-error-inline" role="alert">
                        <span>{demandTargetsError}</span>
                        <button
                          type="button"
                          className="secondary-button small"
                          onClick={() => void loadDemandTargets(formState.clientId, demandSearch, demandTargetsPage)}
                          disabled={demandTargetsLoading}
                        >
                          Tentar novamente
                        </button>
                      </div>
                    )}
                    <select
                      id="material-demand"
                      value={formState.demandId}
                      onChange={(e) => {
                        const newDemandId = e.target.value;
                        setFormState({
                          ...formState,
                          demandId: newDemandId,
                          taskId: '',
                        });
                        if (newDemandId) {
                          void loadTaskTargets(newDemandId, '', 1);
                        } else {
                          setTaskTargets([]);
                          setTaskTargetsTotal(0);
                        }
                      }}
                      disabled={formBusy || !formState.clientId || demandTargetsLoading}
                    >
                      <option value="">
                        {formState.clientId
                          ? 'Nenhum chamado vinculado'
                          : 'Selecione o cliente primeiro'}
                      </option>
                      {formDemandOptions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                    {formState.clientId && demandTotalPages > 1 && (
                      <div className="target-pagination-inline">
                        <button
                          type="button"
                          className="secondary-button small"
                          disabled={demandTargetsPage <= 1 || demandTargetsLoading}
                          onClick={() => {
                            const prev = demandTargetsPage - 1;
                            setDemandTargetsPage(prev);
                            void loadDemandTargets(formState.clientId, demandSearch, prev);
                          }}
                        >
                          ‹ Anterior
                        </button>
                        <span className="target-page-text">
                          Página {demandTargetsPage} de {demandTotalPages} ({demandTargetsTotal} chamados)
                        </span>
                        <button
                          type="button"
                          className="secondary-button small"
                          disabled={demandTargetsPage >= demandTotalPages || demandTargetsLoading}
                          onClick={() => {
                            const next = demandTargetsPage + 1;
                            setDemandTargetsPage(next);
                            void loadDemandTargets(formState.clientId, demandSearch, next);
                          }}
                        >
                          Próxima ›
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="form-group full-width target-selector-box">
                    <label htmlFor="material-task">Tarefa (opcional)</label>
                    {formState.demandId && (
                      <div className="target-search-row">
                        <input
                          type="search"
                          className="target-search-input"
                          placeholder="Buscar tarefa..."
                          aria-label="Buscar tarefa"
                          value={taskSearch}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTaskSearch(val);
                            setTaskTargetsPage(1);
                            void loadTaskTargets(formState.demandId, val, 1);
                          }}
                          disabled={formBusy || taskTargetsLoading}
                        />
                      </div>
                    )}
                    {taskTargetsError && (
                      <div className="target-error-inline" role="alert">
                        <span>{taskTargetsError}</span>
                        <button
                          type="button"
                          className="secondary-button small"
                          onClick={() => void loadTaskTargets(formState.demandId, taskSearch, taskTargetsPage)}
                          disabled={taskTargetsLoading}
                        >
                          Tentar novamente
                        </button>
                      </div>
                    )}
                    <select
                      id="material-task"
                      value={formState.taskId}
                      onChange={(e) => setFormState({ ...formState, taskId: e.target.value })}
                      disabled={formBusy || !formState.demandId || taskTargetsLoading}
                    >
                      <option value="">
                        {formState.demandId
                          ? 'Nenhuma tarefa vinculada'
                          : 'Selecione o chamado primeiro'}
                      </option>
                      {formTaskOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                    {formState.demandId && taskTotalPages > 1 && (
                      <div className="target-pagination-inline">
                        <button
                          type="button"
                          className="secondary-button small"
                          disabled={taskTargetsPage <= 1 || taskTargetsLoading}
                          onClick={() => {
                            const prev = taskTargetsPage - 1;
                            setTaskTargetsPage(prev);
                            void loadTaskTargets(formState.demandId, taskSearch, prev);
                          }}
                        >
                          ‹ Anterior
                        </button>
                        <span className="target-page-text">
                          Página {taskTargetsPage} de {taskTotalPages} ({taskTargetsTotal} tarefas)
                        </span>
                        <button
                          type="button"
                          className="secondary-button small"
                          disabled={taskTargetsPage >= taskTotalPages || taskTargetsLoading}
                          onClick={() => {
                            const next = taskTargetsPage + 1;
                            setTaskTargetsPage(next);
                            void loadTaskTargets(formState.demandId, taskSearch, next);
                          }}
                        >
                          Próxima ›
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={closeForm}
                disabled={formBusy}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={formBusy}
              >
                {formBusy ? 'Salvando...' : editingMaterial ? 'Salvar alterações' : 'Cadastrar material'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Toolbar & Filter Controls */}
      <div className="materials-toolbar">
        <form onSubmit={handleSearchSubmit} className="search-form" noValidate>
          <input
            type="search"
            aria-label="Buscar materiais"
            placeholder="Buscar por título ou descrição..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="secondary-button small">
            Buscar
          </button>
          {appliedSearch && (
            <button
              type="button"
              className="secondary-button small"
              onClick={handleClearSearch}
            >
              Limpar busca
            </button>
          )}
        </form>

        <div className="filter-controls">
          <div className="filter-group" role="group" aria-label="Filtrar por cliente">
            <span className="filter-label">Cliente:</span>
            <select
              aria-label="Filtrar por cliente"
              value={selectedClientId}
              onChange={(e) => {
                setSelectedClientId(e.target.value);
                setPage(1);
              }}
              className="client-select-filter"
            >
              <option value="">Todos os clientes</option>
              {filterClientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            {clientTargetsError && (
              <button
                type="button"
                className="secondary-button small"
                onClick={() => void loadClientTargets(clientSearch, clientTargetsPage)}
                title="Erro ao carregar clientes: recarregar"
              >
                Recarregar clientes
              </button>
            )}
          </div>

          <div className="filter-group" role="group" aria-label="Filtrar por status">
            <span className="filter-label">Status:</span>
            {(['active', 'archived', 'all'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-button filter-btn ${statusFilter === s ? 'active' : ''}`}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                aria-pressed={statusFilter === s}
              >
                {s === 'active' ? 'Ativos' : s === 'archived' ? 'Arquivados' : 'Todos'}
              </button>
            ))}
          </div>

          <div className="filter-group" role="group" aria-label="Filtrar por categoria">
            <span className="filter-label">Categoria:</span>
            <button
              type="button"
              className={`filter-button filter-btn ${categoryFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setCategoryFilter('all');
                setPage(1);
              }}
              aria-pressed={categoryFilter === 'all'}
            >
              Todas
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`filter-button filter-btn ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => {
                  setCategoryFilter(cat);
                  setPage(1);
                }}
                aria-pressed={categoryFilter === cat}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="action-btn text-btn"
              onClick={handleClearAllFilters}
            >
              Limpar todos os filtros
            </button>
          )}
        </div>
      </div>

      {/* Client Timeline Panel (Fase 5) */}
      {selectedClientId && canViewTimeline && (
        <section
          className="client-timeline-panel"
          aria-labelledby="client-timeline-heading"
          data-testid="client-timeline-section"
        >
          <div className="timeline-panel-header">
            <div className="timeline-title-group">
              <h2 id="client-timeline-heading" className="timeline-heading">
                Linha do tempo
              </h2>
              {timelineClientName && (
                <span className="timeline-client-badge" title="Cliente selecionado">
                  {timelineClientName}
                </span>
              )}
              {timelineTotal > 0 && (
                <span className="timeline-count-badge">
                  {timelineTotal} {timelineTotal === 1 ? 'evento registrado' : 'eventos registrados'}
                </span>
              )}
            </div>

            <div className="timeline-header-actions">
              <button
                type="button"
                className="action-btn secondary btn-sm"
                onClick={() => void loadTimeline(selectedClientId, timelinePage)}
                disabled={timelineLoading}
                aria-label="Atualizar linha do tempo"
                title="Recarregar eventos"
              >
                {timelineLoading ? 'Carregando…' : 'Atualizar'}
              </button>
              <button
                type="button"
                className="action-btn secondary btn-sm"
                onClick={() => setTimelineCollapsed((prev) => !prev)}
                aria-expanded={!timelineCollapsed}
                aria-label={timelineCollapsed ? 'Expandir linha do tempo' : 'Recolher linha do tempo'}
              >
                {timelineCollapsed ? 'Expandir' : 'Recolher'}
              </button>
            </div>
          </div>

          {!timelineCollapsed && (
            <>
              {timelineError && (
                <div className="alert-banner error timeline-error-banner" role="alert">
                  <span>{timelineError}</span>
                  <button
                    type="button"
                    className="action-btn secondary btn-sm"
                    onClick={() => void loadTimeline(selectedClientId, timelinePage)}
                    style={{ marginLeft: 12 }}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {timelineLoading && (
                <div className="dashboard-skeleton" aria-live="polite" style={{ padding: '12px 0' }}>
                  <div className="skeleton-line" style={{ width: '100%', height: 36 }} />
                  <div className="skeleton-line" style={{ width: '85%', height: 36 }} />
                </div>
              )}

              {!timelineLoading && !timelineError && timelineEvents.length === 0 && (
                <div className="timeline-empty-state" aria-live="polite">
                  <p>Nenhum evento registrado para este cliente até o momento.</p>
                </div>
              )}

              {!timelineLoading && !timelineError && timelineEvents.length > 0 && (
                <>
                  <ul className="timeline-events-list" aria-label="Eventos do cliente">
                    {timelineEvents.map((evt) => (
                      <li key={evt.id} className="timeline-event-card" data-event-id={evt.id}>
                        <div className="timeline-event-meta">
                          <span
                            className={`timeline-source-badge source-${evt.source}`}
                            title={`Origem: ${TIMELINE_SOURCE_LABELS[evt.source] || evt.source}`}
                          >
                            {TIMELINE_SOURCE_LABELS[evt.source] || evt.source}
                          </span>
                          <span className="timeline-action-badge">
                            {formatTimelineAction(evt.action)}
                          </span>
                          <span className="timeline-actor-name">
                            por <strong>{evt.actorName}</strong>
                          </span>
                          <time className="timeline-timestamp" dateTime={evt.createdAt}>
                            {formatCuiabaDateTime(evt.createdAt)}
                          </time>
                        </div>

                        <div className="timeline-event-body">
                          <span className="timeline-event-title">{evt.title}</span>

                          <div className="timeline-event-actions">
                            {evt.materialId && (
                              <button
                                type="button"
                                className="action-btn secondary btn-sm"
                                data-timeline-action="open-material"
                                data-material-id={evt.materialId}
                                onClick={() => {
                                  const mat = materials.find((m) => m.id === evt.materialId);
                                  if (mat) {
                                    void openHistory(mat);
                                  } else {
                                    setAppliedSearch(evt.title);
                                    setSearchQuery(evt.title);
                                  }
                                }}
                                aria-label={`Abrir material ${evt.title}`}
                              >
                                Abrir material
                              </button>
                            )}

                            {evt.demandId && hasDemandsRead && (
                              <button
                                type="button"
                                className="action-btn secondary btn-sm"
                                data-timeline-action="open-demand"
                                data-demand-id={evt.demandId}
                                onClick={() => {
                                  if (onOpenDemand) {
                                    onOpenDemand(evt.demandId!, evt.taskId);
                                  } else {
                                    setSelectedDemandId(evt.demandId!);
                                    if (evt.taskId) setSelectedTaskId(evt.taskId);
                                  }
                                }}
                                aria-label={`Abrir chamado ${evt.title}`}
                              >
                                Abrir chamado
                              </button>
                            )}

                            {evt.taskId && (
                              <button
                                type="button"
                                className="action-btn secondary btn-sm"
                                data-timeline-action="open-task"
                                data-task-id={evt.taskId}
                                data-demand-id={evt.demandId ?? undefined}
                                onClick={() => {
                                  if (onOpenDemand && evt.demandId) {
                                    onOpenDemand(evt.demandId, evt.taskId!);
                                  } else {
                                    if (evt.demandId) setSelectedDemandId(evt.demandId);
                                    setSelectedTaskId(evt.taskId!);
                                  }
                                }}
                                aria-label={`Abrir tarefa vinculada`}
                              >
                                Abrir tarefa
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {timelineTotal > timelinePageSize && (
                    <nav className="timeline-pagination" aria-label="Paginação da linha do tempo">
                      <span className="pagination-info">
                        Página {timelinePage} de {Math.ceil(timelineTotal / timelinePageSize)}
                      </span>
                      <div className="pagination-buttons">
                        <button
                          type="button"
                          className="pagination-btn"
                          disabled={timelinePage <= 1 || timelineLoading}
                          onClick={() => void loadTimeline(selectedClientId, timelinePage - 1)}
                          aria-label="Página anterior da linha do tempo"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          className="pagination-btn"
                          disabled={
                            timelinePage >= Math.ceil(timelineTotal / timelinePageSize) ||
                            timelineLoading
                          }
                          onClick={() => void loadTimeline(selectedClientId, timelinePage + 1)}
                          aria-label="Próxima página da linha do tempo"
                        >
                          Próxima
                        </button>
                      </div>
                    </nav>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* Main Table / State rendering */}
      {loading ? (
        <div className="dashboard-skeleton" aria-live="polite">
          <div className="skeleton-line" style={{ width: '100%', height: 48 }} />
          <div className="skeleton-line" style={{ width: '90%', height: 48 }} />
          <div className="skeleton-line" style={{ width: '95%', height: 48 }} />
        </div>
      ) : materials.length === 0 ? (
        <div className="empty-state" aria-live="polite">
          <p className="status-text">Nenhum material encontrado com os filtros selecionados.</p>
          {hasActiveFilters && (
            <button
              type="button"
              className="secondary-button small"
              onClick={handleClearAllFilters}
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="data-table" aria-label="Tabela de materiais">
              <thead>
                <tr>
                  <th scope="col">Título e Categoria</th>
                  <th scope="col">Vínculo</th>
                  <th scope="col">Link Externo</th>
                  <th scope="col">Versão / Data</th>
                  <th scope="col" className="text-right">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const isArchived = Boolean(m.archivedAt);
                  return (
                    <tr key={m.id} className={isArchived ? 'archived-row' : ''}>
                      <td>
                        <div className="material-title-cell">
                          <span className="material-title-text">{m.title}</span>
                          <span className={`badge badge-category-${m.category}`}>
                            {CATEGORY_LABELS[m.category] || m.category}
                          </span>
                        </div>
                        {m.description && (
                          <p className="material-desc-muted">{m.description}</p>
                        )}
                      </td>
                      <td>
                        <div className="material-bindings-cell">
                          <span className="binding-client">
                            <strong>Cliente:</strong> {m.client.name}
                            {canViewTimeline && (
                              <button
                                type="button"
                                className="action-btn text-link btn-xs"
                                data-timeline-shortcut="client"
                                onClick={() => {
                                  setSelectedClientId(m.clientId);
                                  setSelectedDemandId('');
                                  setSelectedTaskId('');
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                title={`Ver linha do tempo de ${m.client.name}`}
                                aria-label={`Ver linha do tempo de ${m.client.name}`}
                                style={{ marginLeft: 6, fontSize: '0.75rem', padding: '1px 5px' }}
                              >
                                Linha do tempo
                              </button>
                            )}
                          </span>
                          {m.demand && (
                            <span className="binding-demand">
                              <strong>Chamado:</strong> {m.demand.title}
                            </span>
                          )}
                          {m.task && (
                            <span className="binding-task">
                              <strong>Tarefa:</strong> {m.task.title}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="external-link-anchor"
                          title={m.url}
                        >
                          <span className="link-icon" aria-hidden="true">
                            ↗
                          </span>
                          <span className="link-url-text">{m.url}</span>
                        </a>
                      </td>
                      <td>
                        <div className="material-version-cell">
                          <span className="badge badge-low">v{m.version}</span>
                          <span className="material-date-text">
                            {formatCuiabaDateTime(m.updatedAt)}
                          </span>
                          {isArchived && (
                            <span className="badge badge-status-paused">Arquivado</span>
                          )}
                        </div>
                      </td>
                      <td className="text-right">
                        <div className="action-buttons">
                          <button
                            type="button"
                            className="action-btn history"
                            onClick={() => void openHistory(m)}
                            aria-label={`Ver histórico de ${m.title}`}
                          >
                            Histórico
                          </button>

                          {hasWrite && !isArchived && (
                            <button
                              type="button"
                              className="action-btn edit"
                              onClick={() => openEditForm(m)}
                              aria-label={`Editar ${m.title}`}
                            >
                              Editar
                            </button>
                          )}

                          {hasWrite && (
                            <button
                              type="button"
                              className="action-btn secondary"
                              onClick={() => handleDuplicate(m)}
                              aria-label={`Duplicar referência de ${m.title} em novo cadastro`}
                              title="Duplicar como novo material (sem transferir histórico)"
                            >
                              Duplicar
                            </button>
                          )}

                          {hasArchive &&
                            (isArchived ? (
                              <button
                                type="button"
                                className="action-btn restore"
                                onClick={() => void handleRestore(m)}
                                disabled={archiveBusy}
                              >
                                Restaurar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="action-btn archive"
                                onClick={() => openArchiveConfirm(m)}
                                disabled={archiveBusy}
                              >
                                Arquivar
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="pagination">
            <span className="pagination-info">
              Página {page} de {totalPages} (Total: {total} {total === 1 ? 'material' : 'materiais'})
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                className="secondary-button small"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                className="secondary-button small"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}

      {/* History Dialog / Modal */}
      <dialog
        ref={historyDialogRef}
        className="native-dialog history-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeHistory();
          }
        }}
        onCancel={(e) => {
          e.preventDefault();
          closeHistory();
        }}
      >
        <div className="dialog-content">
          <div className="panel-header">
            <h3>Histórico de Alterações</h3>
            <button
              type="button"
              className="close-button"
              onClick={closeHistory}
              aria-label="Fechar histórico"
            >
              ✕
            </button>
          </div>

          {historyMaterial && (
            <p className="history-material-name">
              Material: <strong>{historyMaterial.title}</strong>
            </p>
          )}

          {historyLoading ? (
            <p className="status-text">Carregando histórico...</p>
          ) : historyError ? (
            <p className="error-text">{historyError}</p>
          ) : historyEvents.length === 0 ? (
            <p className="muted-text">Nenhum evento registrado para este material.</p>
          ) : (
            <ol className="event-list">
              {historyEvents.map((evt) => (
                <li key={evt.id} className="event-item">
                  <div className="event-header">
                    <span className="event-action">{evt.action}</span>
                    <span className="event-meta">
                      {evt.actorName} · {formatCuiabaDateTime(evt.createdAt)}
                    </span>
                  </div>
                  {evt.changes && Object.keys(evt.changes).length > 0 && (
                    <div className="event-changes-diff">
                      {Object.entries(evt.changes).map(([field, diff]) => (
                        <div key={field} className="change-row">
                          <span className="change-field">{field}:</span>
                          <span className="change-before">{String(diff.before ?? '(vazio)')}</span>
                          <span className="change-arrow">→</span>
                          <span className="change-after">{String(diff.after ?? '(vazio)')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          <div className="dialog-actions">
            {canViewTimeline && historyMaterial && (
              <button
                type="button"
                className="secondary-button"
                data-timeline-shortcut="history"
                onClick={() => {
                  const cId = historyMaterial.clientId;
                  closeHistory();
                  setSelectedClientId(cId);
                  setSelectedDemandId('');
                  setSelectedTaskId('');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{ marginRight: 'auto' }}
              >
                Ver linha do tempo do cliente
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={closeHistory}
            >
              Fechar
            </button>
          </div>
        </div>
      </dialog>

      {/* Archive Confirmation Dialog */}
      <dialog
        ref={archiveDialogRef}
        className="native-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !archiveBusy) {
            e.preventDefault();
            closeArchiveConfirm();
          }
        }}
        onCancel={(e) => {
          e.preventDefault();
          closeArchiveConfirm();
        }}
      >
        <div className="dialog-content">
          <h3>Confirmar arquivamento</h3>
          <p>
            Deseja arquivar o material <strong>"{materialToArchive?.title}"</strong>?
          </p>
          <p className="muted-text">
            O material deixará de ser exibido nas listagens ativas, mas seu histórico será integralmente preservado.
          </p>

          {archiveError && (
            <div className="alert-banner error" role="alert">
              <span>{archiveError}</span>
            </div>
          )}

          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={closeArchiveConfirm}
              disabled={archiveBusy}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => void handleConfirmArchive()}
              disabled={archiveBusy}
            >
              {archiveBusy ? 'Arquivando...' : 'Arquivar material'}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
