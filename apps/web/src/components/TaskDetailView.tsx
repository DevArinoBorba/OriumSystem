import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FormEvent } from 'react';
import type {
  Requirement,
  SessionResponse,
  Task,
  TaskComment,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { showToast } from './Toasts.js';
import { DeadlineDate } from './DeadlineDate.js';
import type { UserListItem } from '../types.js';

const MAX_PRINTS_PER_MESSAGE = 4;
const PRINT_REGEX = /!\[[^\]]*\]\((data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+)\)/g;

async function compressImageBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 1440;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.max(1, Math.round((height * maxDim) / width));
          width = maxDim;
        } else {
          width = Math.max(1, Math.round((width * maxDim) / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Falha ao processar print.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      let dataUrl = canvas.toDataURL('image/webp', 0.84);
      if (!dataUrl.startsWith('data:image/webp')) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.84);
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Arquivo de imagem inválido.'));
    };
    img.src = objectUrl;
  });
}

function parseContentWithPrints(raw: string): { text: string; images: string[] } {
  const images: string[] = [];
  const text = raw
    .replace(PRINT_REGEX, (_match, dataUrl: string) => {
      images.push(dataUrl);
      return '';
    })
    .trim();
  return { text, images };
}

function combineTextAndPrints(text: string, images: string[]): string {
  const trimmed = text.trim();
  if (images.length === 0) return trimmed;
  const imageBlocks = images.map((url, idx) => `![Print ${idx + 1}](${url})`).join('\n');
  return trimmed ? `${trimmed}\n\n${imageBlocks}` : imageBlocks;
}

export interface TaskDetailViewProps {
  taskId: string;
  session: SessionResponse;
  availableTasks?: Task[];
  onUnauthorized: () => void;
  onChanged: () => void;
  onBack: () => void;
}

const STATUS_LABELS: Record<Task['status'], string> = {
  blocked: 'Bloqueada',
  ready: 'Pronta para Iniciar',
  in_production: 'Em Produção',
  in_review: 'Em Revisão',
  changes_requested: 'Ajustes Solicitados',
  paused: 'Pausada',
  completed: 'Concluída',
};

const PRIORITY_LABELS: Record<Task['priority'], string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

function isValidPreviewUrl(url: string): boolean {
  if (!url.trim()) return true;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return false;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function TaskDetailView({
  taskId,
  session,
  availableTasks,
  onUnauthorized,
  onChanged,
  onBack,
}: TaskDetailViewProps) {
  const isAdmin = session.roles.includes('administrator');

  // Main task domain data
  const [task, setTask] = useState<Task | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [dependencies, setDependencies] = useState<{ id: string; satisfied: boolean }[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);

  // Async states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Single-flight ref guard
  const isActionBusyRef = useRef(false);
  const activeAbortRef = useRef<AbortController | null>(null);

  // Form Draft States (Preserved on 409 Conflict)
  const [submitReviewDraft, setSubmitReviewDraft] = useState({
    deliveryNotes: '',
    previewUrl: '',
    active: false,
  });

  const [requestPauseDraft, setRequestPauseDraft] = useState({
    reason: '',
    active: false,
  });

  const [approvePauseDraft, setApprovePauseDraft] = useState({
    reason: '',
    deliveryDate: '',
    active: false,
  });

  const [reviewDraft, setReviewDraft] = useState<{
    decision: 'complete' | 'changes_requested';
    feedback: string;
    active: false | boolean;
  }>({
    decision: 'complete',
    feedback: '',
    active: false,
  });

  const [reassignDraft, setReassignDraft] = useState({
    assignedToUserId: '',
    reason: '',
    active: false,
  });

  const [addDepDraft, setAddDepDraft] = useState({
    dependsOnTaskId: '',
    active: false,
  });

  const [commentDraft, setCommentDraft] = useState('');
  const [commentImages, setCommentImages] = useState<string[]>([]);
  const [submitReviewImages, setSubmitReviewImages] = useState<string[]>([]);
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const submitReviewFileInputRef = useRef<HTMLInputElement>(null);
  const reviewFileInputRef = useRef<HTMLInputElement>(null);

  // Is current user assigned to this task?
  const isAssignee = task?.assignedToUserId === session.user.id;

  // Data loader
  const loadData = useCallback(async () => {
    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const taskPromise = api.getTask(taskId, controller.signal, onUnauthorized);
      const commentsPromise = api.getTaskComments(taskId, controller.signal, onUnauthorized);
      const usersPromise = isAdmin
        ? api.listUsers(controller.signal, onUnauthorized)
        : Promise.resolve({ users: [] });

      const [taskRes, commentsRes, usersRes] = await Promise.all([
        taskPromise,
        commentsPromise,
        usersPromise,
      ]);

      if (activeAbortRef.current === controller && !controller.signal.aborted) {
        setTask(taskRes.task);
        setRequirements(taskRes.requirements);
        setDependencies(taskRes.dependencies);
        setComments(commentsRes.comments);
        setUsers(usersRes.users);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      if (activeAbortRef.current === controller) {
        if (err instanceof ApiError && err.status === 403) {
          setError('Você não tem permissão para visualizar esta tarefa.');
        } else if (err instanceof ApiError && err.status === 404) {
          setError('Tarefa não encontrada ou acesso revogado.');
        } else {
          setError('Falha ao carregar dados da tarefa. Tente novamente.');
        }
      }
    } finally {
      if (activeAbortRef.current === controller) {
        setLoading(false);
        activeAbortRef.current = null;
      }
    }
  }, [taskId, isAdmin, onUnauthorized]);

  useEffect(() => {
    loadData();
    return () => {
      activeAbortRef.current?.abort();
    };
  }, [loadData]);

  // Discard draft and reload on 409
  const handleDiscardConflictAndReload = () => {
    setConflictMessage(null);
    setActionError(null);
    setSubmitReviewDraft({ deliveryNotes: '', previewUrl: '', active: false });
    setRequestPauseDraft({ reason: '', active: false });
    setApprovePauseDraft({ reason: '', deliveryDate: '', active: false });
    setReviewDraft({ decision: 'complete', feedback: '', active: false });
    setReassignDraft({ assignedToUserId: '', reason: '', active: false });
    setAddDepDraft({ dependsOnTaskId: '', active: false });
    loadData();
  };

  // Generic action wrapper with single-flight guard and 409 handling
  const executeAction = async (actionFn: () => Promise<void>, successMessage: string) => {
    if (isActionBusyRef.current) return;
    isActionBusyRef.current = true;
    setBusy(true);
    setActionError(null);

    try {
      await actionFn();
      showToast(successMessage);
      setConflictMessage(null);
      await loadData();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          onUnauthorized();
          return;
        }
        if (err.status === 409) {
          setConflictMessage('Esta tarefa foi atualizada por outra pessoa. Seu rascunho foi preservado.');
          setActionError('Esta tarefa foi atualizada por outra pessoa. Seu rascunho foi preservado. Revise os campos e tente novamente, ou descarte o rascunho para recarregar.');
          return;
        }
        if (err.status === 403) {
          setActionError('Você não tem permissão para realizar esta ação.');
          return;
        }
        if (err.status === 400) {
          setActionError(err.message && !err.message.includes('INVALID_INPUT') ? err.message : 'Verifique os dados informados e tente novamente.');
          return;
        }
        setActionError('Não foi possível concluir a ação no momento. Tente novamente.');
      } else {
        setActionError('Não foi possível concluir a ação no momento. Tente novamente.');
      }
    } finally {
      isActionBusyRef.current = false;
      setBusy(false);
    }
  };

  // --- Assignee Actions (Admin não inicia em nome alheio) ---
  const handleAcceptTask = () => {
    if (!task || !isAssignee) return;
    executeAction(async () => {
      const controller = new AbortController();
      await api.acceptTask(task.id, { version: task.version }, controller.signal, onUnauthorized);
    }, 'Tarefa aceita com sucesso!');
  };

  const handleStartTask = () => {
    if (!task || !isAssignee) return;
    executeAction(async () => {
      const controller = new AbortController();
      await api.startTask(task.id, { version: task.version }, controller.signal, onUnauthorized);
    }, 'Produção iniciada com sucesso!');
  };

  useEffect(() => {
    if (!lightboxImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxImage(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxImage]);

  const appendImageBlobs = async (
    blobs: Blob[],
    currentImages: string[],
    setImages: (updater: (prev: string[]) => string[]) => void,
  ) => {
    const remainingSlots = MAX_PRINTS_PER_MESSAGE - currentImages.length;
    if (remainingSlots <= 0) {
      setActionError(`Limite máximo de ${MAX_PRINTS_PER_MESSAGE} prints por envio atingido.`);
      return;
    }
    const toProcess = blobs.slice(0, remainingSlots);
    try {
      const compressed = await Promise.all(toProcess.map((b) => compressImageBlob(b)));
      setImages((prev) => [...prev, ...compressed].slice(0, MAX_PRINTS_PER_MESSAGE));
      setActionError(null);
    } catch {
      setActionError('Não foi possível processar o print colado. Tente outra imagem.');
    }
  };

  const handlePasteImages = (
    event: ClipboardEvent<HTMLTextAreaElement>,
    currentImages: string[],
    setImages: (updater: (prev: string[]) => string[]) => void,
  ) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageBlobs: Blob[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageBlobs.push(file);
      }
    }
    if (imageBlobs.length > 0) {
      event.preventDefault();
      void appendImageBlobs(imageBlobs, currentImages, setImages);
    }
  };

  const handleSelectImageFiles = (
    event: ChangeEvent<HTMLInputElement>,
    currentImages: string[],
    setImages: (updater: (prev: string[]) => string[]) => void,
  ) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;
    const blobs = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    event.target.value = '';
    if (blobs.length > 0) {
      void appendImageBlobs(blobs, currentImages, setImages);
    }
  };

  const handleSubmitReview = (e: FormEvent) => {
    e.preventDefault();
    if (!task || !isAssignee) return;

    const combinedNotes = combineTextAndPrints(submitReviewDraft.deliveryNotes, submitReviewImages);
    if (!combinedNotes) {
      setActionError('As notas de entrega (ou ao menos um print) são obrigatórias.');
      return;
    }

    const trimmedUrl = submitReviewDraft.previewUrl.trim();
    if (trimmedUrl && !isValidPreviewUrl(trimmedUrl)) {
      setActionError('A URL de prévia deve iniciar com http:// ou https://.');
      return;
    }

    executeAction(async () => {
      const controller = new AbortController();
      await api.submitTaskReview(
        task.id,
        {
          version: task.version,
          deliveryNotes: combinedNotes,
          previewUrl: trimmedUrl || null,
        },
        controller.signal,
        onUnauthorized,
      );
      setSubmitReviewDraft({ deliveryNotes: '', previewUrl: '', active: false });
      setSubmitReviewImages([]);
    }, 'Tarefa enviada para revisão com sucesso!');
  };

  const handleRequestPause = (e: FormEvent) => {
    e.preventDefault();
    if (!task || !isAssignee) return;

    const trimmedReason = requestPauseDraft.reason.trim();
    if (!trimmedReason) {
      setActionError('O motivo da solicitação de pausa é obrigatório.');
      return;
    }

    executeAction(async () => {
      const controller = new AbortController();
      await api.requestTaskPause(
        task.id,
        { version: task.version, reason: trimmedReason },
        controller.signal,
        onUnauthorized,
      );
      setRequestPauseDraft({ reason: '', active: false });
    }, 'Solicitação de pausa enviada para análise de Monique!');
  };

  // --- Admin Actions ---
  const handleToggleRequirement = (req: Requirement) => {
    if (!task || !isAdmin) return;
    executeAction(async () => {
      const controller = new AbortController();
      await api.updateTaskRequirement(
        task.id,
        req.id,
        { version: task.version, satisfied: !req.satisfied },
        controller.signal,
        onUnauthorized,
      );
    }, `Requisito "${req.title}" atualizado.`);
  };

  const handleAddDependency = (e: FormEvent) => {
    e.preventDefault();
    if (!task || !isAdmin) return;
    const depId = addDepDraft.dependsOnTaskId.trim();
    if (!depId) {
      setActionError('Selecione uma tarefa para adicionar como dependência.');
      return;
    }

    executeAction(async () => {
      const controller = new AbortController();
      await api.addTaskDependency(
        task.id,
        { version: task.version, dependsOnTaskId: depId },
        controller.signal,
        onUnauthorized,
      );
      setAddDepDraft({ dependsOnTaskId: '', active: false });
    }, 'Dependência adicionada com sucesso!');
  };

  const handleRemoveDependency = (dependencyId: string) => {
    if (!task || !isAdmin) return;
    executeAction(async () => {
      const controller = new AbortController();
      await api.removeTaskDependency(
        task.id,
        dependencyId,
        { version: task.version },
        controller.signal,
        onUnauthorized,
      );
    }, 'Dependência removida com sucesso!');
  };

  const handleReassignTask = (e: FormEvent) => {
    e.preventDefault();
    if (!task || !isAdmin) return;
    const assignedTo = reassignDraft.assignedToUserId.trim();
    const reason = reassignDraft.reason.trim();
    if (!assignedTo) {
      setActionError('Selecione o novo colaborador responsável.');
      return;
    }
    if (!reason) {
      setActionError('A justificativa da reatribuição é obrigatória.');
      return;
    }

    executeAction(async () => {
      const controller = new AbortController();
      await api.reassignTask(
        task.id,
        { version: task.version, assignedToUserId: assignedTo, reason },
        controller.signal,
        onUnauthorized,
      );
      setReassignDraft({ assignedToUserId: '', reason: '', active: false });
    }, 'Tarefa reatribuída com sucesso! Acesso anterior revogado.');
  };

  const handleReviewTask = (e: FormEvent) => {
    e.preventDefault();
    if (!task || !isAdmin) return;
    const feedback = combineTextAndPrints(reviewDraft.feedback, reviewImages);
    if (!feedback) {
      setActionError('O feedback da avaliação é obrigatório.');
      return;
    }

    executeAction(async () => {
      const controller = new AbortController();
      await api.reviewTask(
        task.id,
        {
          version: task.version,
          decision: reviewDraft.decision,
          feedback,
        },
        controller.signal,
        onUnauthorized,
      );
      setReviewDraft({ decision: 'complete', feedback: '', active: false });
      setReviewImages([]);
    }, reviewDraft.decision === 'complete' ? 'Tarefa concluída com sucesso!' : 'Ajustes solicitados ao colaborador.');
  };

  const handleApprovePause = (e: FormEvent) => {
    e.preventDefault();
    if (!task || !isAdmin) return;
    const reason = approvePauseDraft.reason.trim();
    const deliveryDate = approvePauseDraft.deliveryDate.trim();

    if (!reason) {
      setActionError('A justificativa de autorização da pausa é obrigatória.');
      return;
    }
    if (!deliveryDate || !isValidCalendarDate(deliveryDate)) {
      setActionError('Informe uma data de entrega válida no calendário (YYYY-MM-DD).');
      return;
    }

    executeAction(async () => {
      const controller = new AbortController();
      await api.approveTaskPause(
        task.id,
        { version: task.version, reason, deliveryDate },
        controller.signal,
        onUnauthorized,
      );
      setApprovePauseDraft({ reason: '', deliveryDate: '', active: false });
    }, 'Pausa autorizada e nova data de entrega confirmada!');
  };

  const handleResumeTask = () => {
    if (!task || !isAdmin) return;
    executeAction(async () => {
      const controller = new AbortController();
      await api.resumeTask(task.id, { version: task.version }, controller.signal, onUnauthorized);
    }, 'Tarefa retomada para produção!');
  };

  // --- Comments (Assignee and Admin) ---
  const handleAddComment = (e: FormEvent) => {
    e.preventDefault();
    if (!task) return;
    const content = combineTextAndPrints(commentDraft, commentImages);
    if (!content) return;

    executeAction(async () => {
      const controller = new AbortController();
      const res = await api.addTaskComment(
        task.id,
        { content },
        controller.signal,
        onUnauthorized,
      );
      setComments(res.comments);
      setCommentDraft('');
      setCommentImages([]);
    }, 'Comentário adicionado com sucesso!');
  };

  // Helper to format assigned user name
  const assigneeName =
    users.find((u) => u.id === task?.assignedToUserId)?.name ||
    (isAssignee ? session.user.name : 'Colaborador Atribuído');

  if (loading) {
    return (
      <section className="detail-card">
        <p className="muted">Carregando detalhes da tarefa...</p>
      </section>
    );
  }

  if (error || !task) {
    return (
      <section className="detail-card">
        <div className="error" role="alert">
          <p>{error || 'Não foi possível carregar a tarefa.'}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onBack}>
          ← Voltar
        </button>
      </section>
    );
  }

  // Available tasks for dependency dropdown:
  // ONLY for admin, excluding current task and already linked tasks
  const eligibleDepTasks = isAdmin && availableTasks
    ? availableTasks.filter(
        (t) => t.id !== task.id && !dependencies.some((d) => d.id === t.id),
      )
    : [];

  return (
    <article className="task-detail-view detail-card">
      {/* Header bar */}
      <header className="task-header" style={{ marginBottom: '20px' }}>
        <button
          type="button"
          className="text-button"
          onClick={onBack}
          disabled={busy}
          style={{ marginBottom: '12px' }}
        >
          ← Voltar para Demandas
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span className="eyebrow">Tarefa</span>
            <h1 style={{ fontSize: '1.5rem', margin: '4px 0 8px' }}>{task.title}</h1>
            <p className="muted" style={{ margin: 0 }}>
              Responsável: <strong>{assigneeName}</strong> | Entrega: <strong><DeadlineDate date={task.deliveryDate} done={task.status === 'completed'} /></strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className={`badge badge-${task.priority}`}>
              Prioridade: {PRIORITY_LABELS[task.priority]}
            </span>
            <span className={`badge badge-status-${task.status}`}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>
        </div>
      </header>

      {/* Global Alerts / Notices */}
      {actionError && (
        <div className="error" role="alert" style={{ marginBottom: '16px' }}>
          <p>{actionError}</p>
        </div>
      )}

      {conflictMessage && (
        <div className="conflict-panel" role="alert" style={{ background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', padding: '16px', borderRadius: '12px', marginBottom: '16px' }}>
          <p style={{ color: 'var(--color-warning-text)', margin: '0 0 12px', fontWeight: 600 }}>{conflictMessage}</p>
          <button
            type="button"
            className="secondary-button small"
            onClick={handleDiscardConflictAndReload}
            disabled={busy}
          >
            Descartar rascunho e recarregar dados
          </button>
        </div>
      )}

      {/* Description & Metadata */}
      <section className="task-info" style={{ marginBottom: '24px' }}>
        <label>Descrição</label>
        <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 16px', color: 'var(--color-text-main)' }}>
          {task.description || <span className="muted">Nenhuma descrição informada.</span>}
        </p>

        {task.deliveryNotes && (() => {
          const parsedNotes = parseContentWithPrints(task.deliveryNotes);
          return (
            <div style={{ background: 'var(--color-primary-light)', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
              <label>Notas de Entrega (Revisão)</label>
              {parsedNotes.text && (
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{parsedNotes.text}</p>
              )}
              {parsedNotes.images.length > 0 && (
                <div className="comment-prints-grid" style={{ marginTop: '10px' }}>
                  {parsedNotes.images.map((imgUrl, idx) => (
                    <button
                      key={`delivery-print-${idx}`}
                      type="button"
                      className="comment-print-thumb-btn"
                      onClick={() => setLightboxImage(imgUrl)}
                      title="Clique para ampliar o print"
                    >
                      <img src={imgUrl} alt={`Print de entrega ${idx + 1}`} className="comment-print-thumb" />
                    </button>
                  ))}
                </div>
              )}
              {task.previewUrl && (
                <p style={{ margin: '8px 0 0' }}>
                  Prévia: <a href={task.previewUrl} target="_blank" rel="noreferrer noopener" style={{ wordBreak: 'break-all' }}>{task.previewUrl}</a>
                </p>
              )}
            </div>
          );
        })()}

        {task.pauseRequestedAt && task.status === 'in_production' && (
          <div style={{ background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', padding: '14px', borderRadius: '10px', marginBottom: '16px' }}>
            <label style={{ color: 'var(--color-warning-text)', fontWeight: 600 }}>Pausa Solicitada pelo Colaborador</label>
            <p style={{ margin: '4px 0 0', color: 'var(--color-text-main)' }}>Motivo: {task.pauseReason || 'Não informado'}</p>
            <small style={{ color: 'var(--color-text-muted)' }}>Aguardando decisão da administração.</small>
          </div>
        )}

        {task.status === 'paused' && task.pauseReason && (
          <div style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', padding: '14px', borderRadius: '10px', marginBottom: '16px' }}>
            <label style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>Tarefa em Pausa</label>
            <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>Motivo: {task.pauseReason}</p>
          </div>
        )}
      </section>

      {/* Primary Action Buttons (Workflow & Transitions) */}
      <section className="task-actions" style={{ marginBottom: '24px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {/* Assignee Actions (Admin NÃO inicia em nome alheio) */}
        {isAssignee && !task.acceptedAt && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="primary-button"
              onClick={handleAcceptTask}
              disabled={busy}
            >
              Aceitar Tarefa
            </button>
            {task.status === 'ready' && (
              <button
                type="button"
                className="primary-button"
                disabled
                title="Aceite a tarefa antes de iniciar a produção."
              >
                Iniciar Produção
              </button>
            )}
            <small className="muted" style={{ display: 'block', width: '100%', margin: '4px 0 0' }}>
              Aceite a tarefa antes de iniciar a produção.
            </small>
          </div>
        )}

        {isAssignee && task.acceptedAt && (task.status === 'ready' || task.status === 'changes_requested') && (
          <button
            type="button"
            className="primary-button"
            onClick={handleStartTask}
            disabled={busy}
          >
            {task.status === 'changes_requested' ? 'Retomar Ajustes' : 'Iniciar Produção'}
          </button>
        )}

        {isAssignee && task.status === 'in_production' && (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={() => setSubmitReviewDraft((prev) => ({ ...prev, active: !prev.active }))}
              disabled={busy}
            >
              {submitReviewDraft.active ? 'Cancelar Submissão' : 'Submeter para Revisão'}
            </button>

            {!task.pauseRequestedAt && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRequestPauseDraft((prev) => ({ ...prev, active: !prev.active }))}
                disabled={busy}
              >
                {requestPauseDraft.active ? 'Cancelar Solicitação' : 'Solicitar Pausa'}
              </button>
            )}
          </>
        )}

        {/* Admin Actions */}
        {isAdmin && task.status === 'in_review' && (
          <button
            type="button"
            className="primary-button"
            onClick={() => setReviewDraft((prev) => ({ ...prev, active: !prev.active }))}
            disabled={busy}
          >
            {reviewDraft.active ? 'Fechar Painel de Revisão' : 'Avaliar / Revisar Tarefa'}
          </button>
        )}

        {isAdmin && task.pauseRequestedAt && task.status === 'in_production' && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setApprovePauseDraft((prev) => ({ ...prev, active: !prev.active }))}
            disabled={busy}
          >
            {approvePauseDraft.active ? 'Fechar Painel de Pausa' : 'Autorizar Pausa (Monique)'}
          </button>
        )}

        {isAdmin && task.status === 'paused' && (
          <button
            type="button"
            className="primary-button"
            onClick={handleResumeTask}
            disabled={busy}
          >
            Retomar Tarefa
          </button>
        )}

        {isAdmin && !task.startedAt && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReassignDraft((prev) => ({ ...prev, active: !prev.active }))}
            disabled={busy}
          >
            {reassignDraft.active ? 'Cancelar Reatribuição' : 'Reatribuir Tarefa'}
          </button>
        )}
      </section>

      {/* --- Inline Forms --- */}

      {/* Form: Submeter para Revisão (Assignee) */}
      {isAssignee && submitReviewDraft.active && (
        <form onSubmit={handleSubmitReview} className="inline-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <h3>Submeter Tarefa para Revisão</h3>

          <div>
            <label htmlFor="deliveryNotes">Notas de Entrega *</label>
            <textarea
              id="deliveryNotes"
              value={submitReviewDraft.deliveryNotes}
              onChange={(e) => setSubmitReviewDraft({ ...submitReviewDraft, deliveryNotes: e.target.value })}
              onPaste={(e) => handlePasteImages(e, submitReviewImages, setSubmitReviewImages)}
              placeholder="Descreva o que foi entregue, referências e orientações de validação... (Cole prints com Ctrl + V)"
              disabled={busy}
              required={submitReviewImages.length === 0}
            />
            <div className="print-paste-toolbar">
              <input
                ref={submitReviewFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleSelectImageFiles(e, submitReviewImages, setSubmitReviewImages)}
              />
              <button
                type="button"
                className="secondary-button small"
                onClick={() => submitReviewFileInputRef.current?.click()}
                disabled={busy || submitReviewImages.length >= MAX_PRINTS_PER_MESSAGE}
              >
                📎 Anexar print ({submitReviewImages.length}/{MAX_PRINTS_PER_MESSAGE})
              </button>
              <span className="print-paste-hint">ou pressione <strong>Ctrl + V</strong> no campo de texto</span>
            </div>
            {submitReviewImages.length > 0 && (
              <div className="comment-prints-draft-grid">
                {submitReviewImages.map((imgUrl, idx) => (
                  <div key={`sub-draft-${idx}`} className="comment-print-draft-item">
                    <button
                      type="button"
                      className="comment-print-thumb-btn"
                      onClick={() => setLightboxImage(imgUrl)}
                      title="Clique para ampliar"
                    >
                      <img src={imgUrl} alt={`Print anexado ${idx + 1}`} className="comment-print-thumb" />
                    </button>
                    <button
                      type="button"
                      className="comment-print-remove-btn"
                      onClick={() => setSubmitReviewImages((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remover print ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="previewUrl">URL de Prévia (opcional, somente http/https)</label>
            <input
              id="previewUrl"
              type="url"
              value={submitReviewDraft.previewUrl}
              onChange={(e) => setSubmitReviewDraft({ ...submitReviewDraft, previewUrl: e.target.value })}
              placeholder="https://exemplo.com/preview"
              disabled={busy}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Enviando...' : 'Confirmar Envio para Revisão'}
            </button>
            <button
              type="button"
              className="cancel"
              onClick={() => setSubmitReviewDraft((prev) => ({ ...prev, active: false }))}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Form: Solicitar Pausa (Assignee) */}
      {isAssignee && requestPauseDraft.active && (
        <form onSubmit={handleRequestPause} className="inline-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <h3>Solicitar Pausa da Tarefa</h3>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            A solicitação não altera o prazo nem o status da tarefa até a avaliação da administração.
          </p>

          <div>
            <label htmlFor="pauseReason">Motivo da Pausa *</label>
            <textarea
              id="pauseReason"
              value={requestPauseDraft.reason}
              onChange={(e) => setRequestPauseDraft({ ...requestPauseDraft, reason: e.target.value })}
              placeholder="Ex.: Aguardando envio de credenciais ou assets pelo cliente..."
              disabled={busy}
              required
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Enviando...' : 'Enviar Solicitação'}
            </button>
            <button
              type="button"
              className="cancel"
              onClick={() => setRequestPauseDraft((prev) => ({ ...prev, active: false }))}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Form: Avaliar Tarefa (Admin) */}
      {isAdmin && reviewDraft.active && (
        <form onSubmit={handleReviewTask} className="inline-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <h3>Avaliação da Tarefa</h3>

          <div style={{ display: 'flex', gap: '16px', margin: '8px 0' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="decision"
                value="complete"
                checked={reviewDraft.decision === 'complete'}
                onChange={() => setReviewDraft({ ...reviewDraft, decision: 'complete' })}
                disabled={busy}
                style={{ width: 'auto', minHeight: 'auto' }}
              />
              Aprovar e Concluir
            </label>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="decision"
                value="changes_requested"
                checked={reviewDraft.decision === 'changes_requested'}
                onChange={() => setReviewDraft({ ...reviewDraft, decision: 'changes_requested' })}
                disabled={busy}
                style={{ width: 'auto', minHeight: 'auto' }}
              />
              Solicitar Ajustes
            </label>
          </div>

          <div>
            <label htmlFor="reviewFeedback">Feedback / Justificativa *</label>
            <textarea
              id="reviewFeedback"
              value={reviewDraft.feedback}
              onChange={(e) => setReviewDraft({ ...reviewDraft, feedback: e.target.value })}
              onPaste={(e) => handlePasteImages(e, reviewImages, setReviewImages)}
              placeholder="Descreva os pontos validados ou os ajustes necessários... (Cole prints com Ctrl + V)"
              disabled={busy}
              required={reviewImages.length === 0}
            />
            <div className="print-paste-toolbar">
              <input
                ref={reviewFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleSelectImageFiles(e, reviewImages, setReviewImages)}
              />
              <button
                type="button"
                className="secondary-button small"
                onClick={() => reviewFileInputRef.current?.click()}
                disabled={busy || reviewImages.length >= MAX_PRINTS_PER_MESSAGE}
              >
                📎 Anexar print ({reviewImages.length}/{MAX_PRINTS_PER_MESSAGE})
              </button>
              <span className="print-paste-hint">ou pressione <strong>Ctrl + V</strong> no campo de texto</span>
            </div>
            {reviewImages.length > 0 && (
              <div className="comment-prints-draft-grid">
                {reviewImages.map((imgUrl, idx) => (
                  <div key={`rev-draft-${idx}`} className="comment-print-draft-item">
                    <button
                      type="button"
                      className="comment-print-thumb-btn"
                      onClick={() => setLightboxImage(imgUrl)}
                      title="Clique para ampliar"
                    >
                      <img src={imgUrl} alt={`Print anexado ${idx + 1}`} className="comment-print-thumb" />
                    </button>
                    <button
                      type="button"
                      className="comment-print-remove-btn"
                      onClick={() => setReviewImages((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remover print ${idx + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Gravando...' : 'Concluir Avaliação'}
            </button>
            <button
              type="button"
              className="cancel"
              onClick={() => setReviewDraft((prev) => ({ ...prev, active: false }))}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Form: Autorizar Pausa com Nova Data (Admin) */}
      {isAdmin && approvePauseDraft.active && (
        <form onSubmit={handleApprovePause} className="inline-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <h3>Autorizar Pausa da Tarefa (Monique)</h3>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            Solicitação do colaborador: <strong>{task.pauseReason || 'Sem motivo detalhado'}</strong>
          </p>

          <div>
            <label htmlFor="approveReason">Justificativa da Autorização *</label>
            <input
              id="approveReason"
              type="text"
              value={approvePauseDraft.reason}
              onChange={(e) => setApprovePauseDraft({ ...approvePauseDraft, reason: e.target.value })}
              placeholder="Ex.: Pausa autorizada conforme alinhamento com cliente"
              disabled={busy}
              required
            />
          </div>

          <div>
            <label htmlFor="newDeliveryDate">Nova Data de Entrega (YYYY-MM-DD) *</label>
            <input
              id="newDeliveryDate"
              type="date"
              value={approvePauseDraft.deliveryDate}
              onChange={(e) => setApprovePauseDraft({ ...approvePauseDraft, deliveryDate: e.target.value })}
              disabled={busy}
              required
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Gravando...' : 'Aprovar Pausa e Prorrogar Prazo'}
            </button>
            <button
              type="button"
              className="cancel"
              onClick={() => setApprovePauseDraft((prev) => ({ ...prev, active: false }))}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Form: Reatribuir Tarefa (Admin antes do início) */}
      {isAdmin && reassignDraft.active && (
        <form onSubmit={handleReassignTask} className="inline-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <h3>Reatribuir Tarefa</h3>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            A reatribuição limpa o aceite e revoga o acesso do colaborador anterior imediatamente.
          </p>

          <div>
            <label htmlFor="reassignUser">Novo Responsável *</label>
            <select
              id="reassignUser"
              value={reassignDraft.assignedToUserId}
              onChange={(e) => setReassignDraft({ ...reassignDraft, assignedToUserId: e.target.value })}
              disabled={busy}
              required
            >
              <option value="">Selecione um usuário...</option>
              {users
                .filter((u) => u.active && u.id !== task.assignedToUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label htmlFor="reassignReason">Justificativa da Reatribuição *</label>
            <input
              id="reassignReason"
              type="text"
              value={reassignDraft.reason}
              onChange={(e) => setReassignDraft({ ...reassignDraft, reason: e.target.value })}
              placeholder="Ex.: Realinhamento de capacidade da equipe"
              disabled={busy}
              required
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Reatribuindo...' : 'Confirmar Reatribuição'}
            </button>
            <button
              type="button"
              className="cancel"
              onClick={() => setReassignDraft((prev) => ({ ...prev, active: false }))}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* --- Requirements Section --- */}
      <section className="requirements-section" style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '12px' }}>Requisitos da Tarefa</h2>
        {requirements.length === 0 ? (
          <p className="muted">Nenhum requisito cadastrado para esta tarefa.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '8px' }}>
            {requirements.map((req) => (
              <li
                key={req.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                }}
              >
                {isAdmin ? (
                  <input
                    type="checkbox"
                    checked={req.satisfied}
                    onChange={() => handleToggleRequirement(req)}
                    disabled={busy}
                    aria-label={`Marcar requisito ${req.title}`}
                    style={{ width: '18px', minHeight: '18px', cursor: 'pointer' }}
                  />
                ) : (
                  <span style={{ fontSize: '1.2rem', color: req.satisfied ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {req.satisfied ? '✓' : '✗'}
                  </span>
                )}
                <span style={{ flex: 1, textDecoration: req.satisfied ? 'line-through' : 'none' }}>
                  {req.title} {req.mandatory && <strong style={{ color: 'var(--color-danger)' }}>*</strong>}
                </span>
                <span className={`badge ${req.satisfied ? 'badge-success' : 'badge-warning'}`}>
                  {req.satisfied ? 'Satisfeito' : 'Pendente'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Dependencies Section --- */}
      <section className="dependencies-section" style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Dependências (Grafo DAG)</h2>
          {isAdmin && !task.startedAt && eligibleDepTasks.length > 0 && (
            <button
              type="button"
              className="secondary-button small"
              onClick={() => setAddDepDraft((prev) => ({ ...prev, active: !prev.active }))}
              disabled={busy}
            >
              {addDepDraft.active ? 'Cancelar' : '+ Adicionar Dependência'}
            </button>
          )}
        </div>

        {/* Add Dependency Inline Form (Admin only) */}
        {isAdmin && addDepDraft.active && (
          <form onSubmit={handleAddDependency} style={{ padding: '12px', background: 'var(--color-primary-light)', borderRadius: '8px', marginBottom: '12px' }}>
            <label htmlFor="dependsOnTaskId">Selecionar Tarefa Pré-requisito</label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <select
                id="dependsOnTaskId"
                value={addDepDraft.dependsOnTaskId}
                onChange={(e) => setAddDepDraft({ ...addDepDraft, dependsOnTaskId: e.target.value })}
                disabled={busy}
                required
              >
                <option value="">Selecione uma tarefa da demanda...</option>
                {eligibleDepTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({STATUS_LABELS[t.status]})
                  </option>
                ))}
              </select>
              <button type="submit" className="primary-button small" disabled={busy}>
                Vincular
              </button>
            </div>
          </form>
        )}

        {dependencies.length === 0 ? (
          <p className="muted">Nenhuma dependência necessária para esta tarefa.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '8px' }}>
            {dependencies.map((dep, idx) => {
              // Privacy rule: Only admin can see names of other tasks via availableTasks!
              const depTitle = isAdmin && availableTasks
                ? availableTasks.find((t) => t.id === dep.id)?.title || `Tarefa (${dep.id.slice(0, 8)})`
                : `Pré-requisito #${idx + 1}`;

              return (
                <li
                  key={dep.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                >
                  <div>
                    <strong>{depTitle}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge ${dep.satisfied ? 'badge-success' : 'badge-warning'}`}>
                      {dep.satisfied ? 'Concluída' : 'Bloqueante'}
                    </span>
                    {isAdmin && !task.startedAt && (
                      <button
                        type="button"
                        className="text-button"
                        style={{ color: 'var(--color-danger)', padding: '0 4px', minHeight: '30px' }}
                        onClick={() => handleRemoveDependency(dep.id)}
                        disabled={busy}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- Comments Section (Assignee & Admin) --- */}
      <section className="comments-section" style={{ marginTop: '32px', borderTop: '1px solid var(--color-border)', paddingTop: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '16px' }}>Comentários da Tarefa</h2>

        {comments.length === 0 ? (
          <p className="muted">Nenhum comentário registrado.</p>
        ) : (
          <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
            {comments.map((c) => {
              const parsed = parseContentWithPrints(c.content);
              return (
                <div
                  key={c.id}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <strong>{c.authorName}</strong>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {new Date(c.createdAt).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  {parsed.text && (
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-text-main)' }}>{parsed.text}</p>
                  )}
                  {parsed.images.length > 0 && (
                    <div className="comment-prints-grid" style={{ marginTop: parsed.text ? '10px' : '4px' }}>
                      {parsed.images.map((imgUrl, idx) => (
                        <button
                          key={`${c.id}-print-${idx}`}
                          type="button"
                          className="comment-print-thumb-btn"
                          onClick={() => setLightboxImage(imgUrl)}
                          title="Clique para ampliar o print"
                        >
                          <img src={imgUrl} alt={`Print do comentário ${idx + 1}`} className="comment-print-thumb" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add comment inline form */}
        <form onSubmit={handleAddComment} style={{ display: 'grid', gap: '8px' }}>
          <label htmlFor="newComment">Adicionar Comentário</label>
          <textarea
            id="newComment"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onPaste={(e) => handlePasteImages(e, commentImages, setCommentImages)}
            placeholder="Escreva um comentário sobre o andamento da tarefa... (Dica: pressione Ctrl + V para colar prints direto da área de transferência)"
            disabled={busy}
            rows={3}
            required={commentImages.length === 0}
          />

          <div className="print-paste-toolbar">
            <input
              ref={commentFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleSelectImageFiles(e, commentImages, setCommentImages)}
            />
            <button
              type="button"
              className="secondary-button small"
              onClick={() => commentFileInputRef.current?.click()}
              disabled={busy || commentImages.length >= MAX_PRINTS_PER_MESSAGE}
            >
              📎 Anexar print / imagem ({commentImages.length}/{MAX_PRINTS_PER_MESSAGE})
            </button>
            <span className="print-paste-hint">
              💡 Você também pode colar prints direto com <strong>Ctrl + V</strong> no campo acima
            </span>
          </div>

          {commentImages.length > 0 && (
            <div className="comment-prints-draft-grid" aria-label="Prints anexados ao comentário">
              {commentImages.map((imgUrl, idx) => (
                <div key={`comment-draft-${idx}`} className="comment-print-draft-item">
                  <button
                    type="button"
                    className="comment-print-thumb-btn"
                    onClick={() => setLightboxImage(imgUrl)}
                    title="Clique para ampliar o print"
                  >
                    <img src={imgUrl} alt={`Print anexado ${idx + 1}`} className="comment-print-thumb" />
                  </button>
                  <button
                    type="button"
                    className="comment-print-remove-btn"
                    onClick={() => setCommentImages((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label={`Remover print ${idx + 1}`}
                    title="Remover print"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ justifySelf: 'start', marginTop: '4px' }}>
            <button
              type="submit"
              className="primary-button small"
              disabled={busy || (!commentDraft.trim() && commentImages.length === 0)}
            >
              {busy ? 'Enviando...' : 'Publicar Comentário'}
            </button>
          </div>
        </form>
      </section>

      {/* Lightbox modal for viewing attached prints in full resolution */}
      {lightboxImage && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Visualização ampliada do print"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setLightboxImage(null);
            }
          }}
        >
          <div className="print-lightbox-card">
            <div className="print-lightbox-header">
              <span>Visualização do Print</span>
              <button
                type="button"
                className="close-button"
                onClick={() => setLightboxImage(null)}
                aria-label="Fechar visualização do print"
              >
                ✕
              </button>
            </div>
            <div className="print-lightbox-body">
              <img src={lightboxImage} alt="Print ampliado" className="print-lightbox-img" />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export default TaskDetailView;
