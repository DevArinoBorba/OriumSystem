import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  instantiateDemandTemplateInputSchema,
  type Client,
  type DemandPriority,
  type DemandTemplate,
  type DemandTemplateCategory,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';
import type { UserListItem } from '../types.js';

interface UseTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  users: UserListItem[];
  onDemandCreated: (demandId: string, title: string) => void;
  onUnauthorized: () => void;
}

function toLocalDateInput(offsetDays = 0): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const categoryLabels: Record<DemandTemplateCategory, string> = {
  general: 'Geral',
  web: 'Web',
  design: 'Design',
  video: 'Vídeo',
  marketing: 'Marketing',
  social_media: 'Redes Sociais',
};

const priorityLabels: Record<DemandPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

export function UseTemplateModal({
  isOpen,
  onClose,
  clients,
  users,
  onDemandCreated,
  onUnauthorized,
}: UseTemplateModalProps) {
  const [templates, setTemplates] = useState<DemandTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | DemandTemplateCategory>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<DemandTemplate | null>(null);

  // Form states
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<DemandPriority>('normal');
  const [startDate, setStartDate] = useState(() => toLocalDateInput(0));
  const [deliveryDate, setDeliveryDate] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const requestRef = useRef<AbortController | null>(null);
  const submitRef = useRef(false);

  const loadTemplates = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await api.listDemandTemplates(
        { active: true },
        controller.signal,
        onUnauthorized,
      );
      if (requestRef.current === controller && !controller.signal.aborted) {
        setTemplates(response.templates);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      if (requestRef.current === controller) {
        if (err instanceof ApiError && err.status === 403) {
          setError('Você não tem permissão para listar templates de demandas.');
        } else {
          setError('Não foi possível carregar os templates disponíveis.');
        }
      }
    } finally {
      if (requestRef.current === controller) {
        setLoading(false);
        requestRef.current = null;
      }
    }
  }, [onUnauthorized]);

  useEffect(() => {
    if (isOpen) {
      void loadTemplates();
      setSelectedTemplate(null);
      setFormError(null);
    }
    return () => {
      requestRef.current?.abort();
    };
  }, [isOpen, loadTemplates]);

  // When a template is selected, initialize form fields
  function handleSelectTemplate(tpl: DemandTemplate) {
    setSelectedTemplate(tpl);
    setTitle(tpl.title);
    setDescription(tpl.description || '');
    setPriority(tpl.defaultPriority);
    setStartDate(toLocalDateInput(0));
    setDeliveryDate(tpl.estimatedDays ? toLocalDateInput(tpl.estimatedDays) : '');
    setAssignments({});
    setFormError(null);
  }

  function handleAssignmentChange(taskIdOrTempId: string, userId: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      if (!userId) {
        delete next[taskIdOrTempId];
      } else {
        next[taskIdOrTempId] = userId;
      }
      return next;
    });
  }

  async function handleInstantiate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || submitRef.current) return;

    if (!clientId) {
      setFormError('Selecione um cliente para o chamado.');
      return;
    }

    const payload = {
      clientId,
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      priority,
      startDate: startDate || undefined,
      deliveryDate: deliveryDate || undefined,
      assignments: Object.keys(assignments).length > 0 ? assignments : undefined,
    };

    const validation = instantiateDemandTemplateInputSchema.safeParse(payload);
    if (!validation.success) {
      const firstIssue = validation.error.issues[0];
      setFormError(firstIssue?.message || 'Verifique os dados informados.');
      return;
    }

    submitRef.current = true;
    setSubmitting(true);
    setFormError(null);

    const controller = new AbortController();
    try {
      const response = await api.instantiateDemandTemplate(
        selectedTemplate.id,
        validation.data,
        controller.signal,
        onUnauthorized,
      );
      onDemandCreated(response.demand.id, response.demand.title);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setFormError('Você não tem permissão para abrir chamados a partir de templates.');
      } else if (err instanceof ApiError && err.status === 404) {
        setFormError('O template ou o cliente selecionado não foi encontrado ou está inativo.');
      } else {
        setFormError('Falha ao instanciar chamado a partir do template. Tente novamente.');
      }
    } finally {
      submitRef.current = false;
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const filteredTemplates = templates.filter(
    (t) => categoryFilter === 'all' || t.category === categoryFilter,
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="use-template-title">
      <div className="modal-card wide">
        <div className="modal-header">
          <h2 id="use-template-title">
            {selectedTemplate ? `Instanciar chamado: ${selectedTemplate.title}` : 'Usar template de demanda'}
          </h2>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            aria-label="Fechar janela"
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="alert-banner error" role="alert" style={{ margin: '16px 24px 0' }}>
            <span>{error}</span>
          </div>
        )}

        {!selectedTemplate ? (
          <div className="modal-body template-selection-body">
            <div className="filter-group" role="group" aria-label="Filtrar por categoria" style={{ marginBottom: 16 }}>
              <span className="filter-label">Categoria:</span>
              <button
                type="button"
                className={`filter-button ${categoryFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCategoryFilter('all')}
              >
                Todas
              </button>
              {(Object.keys(categoryLabels) as DemandTemplateCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`filter-button ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {categoryLabels[cat]}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="empty-state" aria-live="polite">
                <p className="status-text">Carregando templates…</p>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">Nenhum template encontrado.</p>
                <p className="empty-description">
                  {categoryFilter !== 'all'
                    ? 'Não há templates ativos nesta categoria.'
                    : 'Ainda não há templates cadastrados no sistema.'}
                </p>
              </div>
            ) : (
              <div className="template-grid">
                {filteredTemplates.map((tpl) => (
                  <div key={tpl.id} className="template-card">
                    <div className="template-card-header">
                      <span className="badge category-badge">{categoryLabels[tpl.category]}</span>
                      <span className={`priority-badge ${tpl.defaultPriority}`}>
                        {priorityLabels[tpl.defaultPriority]}
                      </span>
                    </div>
                    <h3 className="template-card-title">{tpl.title}</h3>
                    <p className="template-card-desc">{tpl.description || <em>Sem descrição.</em>}</p>
                    <div className="template-card-meta">
                      <span>{tpl.tasks.length} tarefa(s)</span>
                      <span>•</span>
                      <span>~{tpl.estimatedDays} dia(s)</span>
                    </div>
                    <div className="template-card-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => handleSelectTemplate(tpl)}
                      >
                        Selecionar template
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={(e) => void handleInstantiate(e)} noValidate className="modal-body">
            {formError && (
              <div className="alert-banner error" role="alert" style={{ marginBottom: 16 }}>
                <span>{formError}</span>
              </div>
            )}

            <div className="template-banner-info">
              <div>
                <strong>Categoria:</strong> {categoryLabels[selectedTemplate.category]} •{' '}
                <strong>Estimativa:</strong> ~{selectedTemplate.estimatedDays} dias •{' '}
                <strong>Tarefas pré-configuradas:</strong> {selectedTemplate.tasks.length}
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setSelectedTemplate(null)}
                disabled={submitting}
              >
                ← Escolher outro template
              </button>
            </div>

            <div className="form-field" style={{ marginTop: 12 }}>
              <label htmlFor="tpl-inst-client">Cliente *</label>
              <select
                id="tpl-inst-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                disabled={submitting}
              >
                <option value="" disabled>
                  Selecione o cliente…
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="tpl-inst-title">Título do chamado *</label>
              <input
                id="tpl-inst-title"
                type="text"
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-field">
              <label htmlFor="tpl-inst-desc">Descrição</label>
              <textarea
                id="tpl-inst-desc"
                rows={3}
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="form-row">
              <div className="form-field">
                <label htmlFor="tpl-inst-priority">Prioridade</label>
                <select
                  id="tpl-inst-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as DemandPriority)}
                  disabled={submitting}
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="tpl-inst-start">Data de início</label>
                <input
                  id="tpl-inst-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="form-field">
                <label htmlFor="tpl-inst-delivery">Data de entrega geral</label>
                <input
                  id="tpl-inst-delivery"
                  type="date"
                  value={deliveryDate}
                  min={startDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            {/* Tasks preview & assignment */}
            <div className="template-tasks-section">
              <h3 className="section-heading" style={{ fontSize: '1rem', marginTop: 16 }}>
                Tarefas do template e atribuição de responsáveis
              </h3>
              <p className="muted-text" style={{ marginBottom: 12 }}>
                Cada tarefa será criada automaticamente com seus prazos e requisitos calculados.
              </p>

              <div className="template-task-list">
                {selectedTemplate.tasks.map((task, index) => (
                  <div key={task.id} className="template-task-preview-card">
                    <div className="task-preview-info">
                      <div className="task-preview-title">
                        <span className="task-preview-index">#{index + 1}</span>
                        <strong>{task.title}</strong>
                        <span className={`priority-badge ${task.priority}`}>
                          {priorityLabels[task.priority]}
                        </span>
                      </div>
                      <div className="task-preview-meta">
                        <span>Offset: +{task.dayOffsetStart}d</span>
                        <span>•</span>
                        <span>Duração: {task.durationDays}d</span>
                        {task.requirements.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{task.requirements.length} requisito(s)</span>
                          </>
                        )}
                      </div>
                      {task.description && (
                        <p className="task-preview-desc">{task.description}</p>
                      )}
                    </div>

                    <div className="task-preview-assignment">
                      <label htmlFor={`assign-${task.id}`} className="sr-only">
                        Responsável pela tarefa {task.title}
                      </label>
                      <select
                        id={`assign-${task.id}`}
                        value={assignments[task.id] ?? ''}
                        onChange={(e) => handleAssignmentChange(task.id, e.target.value)}
                        disabled={submitting}
                      >
                        <option value="">Sem responsável inicial</option>
                        {users.filter((u) => u.active).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.role === 'administrator' ? 'Admin' : 'Colaborador'})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-actions" style={{ marginTop: 24 }}>
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? 'Instanciando…' : 'Criar chamado a partir do template'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
