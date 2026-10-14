import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createDemandTemplateInputSchema,
  type CreateDemandTemplateInput,
  type DemandPriority,
  type DemandTemplate,
  type DemandTemplateCategory,
  type Role,
  type TaskPriority,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';

interface ManageTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}

const categoryLabels: Record<DemandTemplateCategory, string> = {
  general: 'Geral',
  web: 'Web',
  design: 'Design',
  video: 'Vídeo',
  marketing: 'Marketing',
  social_media: 'Redes Sociais',
};

const priorityLabels: Record<DemandPriority | TaskPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

type TaskDraft = {
  tempId: string;
  title: string;
  description: string;
  suggestedRole: Role;
  priority: TaskPriority;
  dayOffsetStart: number;
  durationDays: number;
  requirements: { title: string; mandatory: boolean }[];
};

const emptyTaskDraft = (index: number): TaskDraft => ({
  tempId: `task-${Date.now()}-${index}`,
  title: '',
  description: '',
  suggestedRole: 'collaborator',
  priority: 'normal',
  dayOffsetStart: 0,
  durationDays: 1,
  requirements: [],
});

export function ManageTemplatesModal({
  isOpen,
  onClose,
  onUnauthorized,
}: ManageTemplatesModalProps) {
  const [templates, setTemplates] = useState<DemandTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Mode: list vs create
  const [mode, setMode] = useState<'list' | 'create'>('list');

  // Create form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DemandTemplateCategory>('general');
  const [defaultPriority, setDefaultPriority] = useState<DemandPriority>('normal');
  const [estimatedDays, setEstimatedDays] = useState(5);
  const [tasks, setTasks] = useState<TaskDraft[]>([emptyTaskDraft(1)]);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const requestRef = useRef<AbortController | null>(null);
  const submitRef = useRef(false);

  const loadTemplates = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setListError(null);
    try {
      const response = await api.listDemandTemplates({}, controller.signal, onUnauthorized);
      if (requestRef.current === controller && !controller.signal.aborted) {
        setTemplates(response.templates);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      if (requestRef.current === controller) {
        if (err instanceof ApiError && err.status === 403) {
          setListError('Você não tem permissão para gerenciar templates.');
        } else {
          setListError('Não foi possível carregar a lista de templates.');
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
      setMode('list');
      setActionNotice(null);
      setFormError(null);
    }
    return () => {
      requestRef.current?.abort();
    };
  }, [isOpen, loadTemplates]);

  async function handleToggleActive(template: DemandTemplate) {
    const controller = new AbortController();
    try {
      await api.updateDemandTemplate(
        template.id,
        { version: template.version, active: !template.active },
        controller.signal,
        onUnauthorized,
      );
      setActionNotice(
        `Template "${template.title}" ${!template.active ? 'ativado' : 'desativado'} com sucesso.`,
      );
      void loadTemplates();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setActionNotice('Conflito de versão: o template foi alterado por outro usuário.');
      } else {
        setActionNotice('Falha ao atualizar o status do template.');
      }
    }
  }

  function handleAddTask() {
    setTasks((prev) => [...prev, emptyTaskDraft(prev.length + 1)]);
  }

  function handleRemoveTask(index: number) {
    if (tasks.length <= 1) return;
    setTasks((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUpdateTask<K extends keyof TaskDraft>(index: number, field: K, value: TaskDraft[K]) {
    setTasks((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index]!, [field]: value };
      return copy;
    });
  }

  function handleAddRequirement(taskIndex: number) {
    setTasks((prev) => {
      const copy = [...prev];
      const target = copy[taskIndex]!;
      copy[taskIndex] = {
        ...target,
        requirements: [...target.requirements, { title: '', mandatory: true }],
      };
      return copy;
    });
  }

  function handleRemoveRequirement(taskIndex: number, reqIndex: number) {
    setTasks((prev) => {
      const copy = [...prev];
      const target = copy[taskIndex]!;
      copy[taskIndex] = {
        ...target,
        requirements: target.requirements.filter((_, ri) => ri !== reqIndex),
      };
      return copy;
    });
  }

  function handleUpdateRequirement(
    taskIndex: number,
    reqIndex: number,
    field: 'title' | 'mandatory',
    val: string | boolean,
  ) {
    setTasks((prev) => {
      const copy = [...prev];
      const target = copy[taskIndex]!;
      const reqs = [...target.requirements];
      reqs[reqIndex] = { ...reqs[reqIndex]!, [field]: val };
      copy[taskIndex] = { ...target, requirements: reqs };
      return copy;
    });
  }

  async function handleCreateTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitRef.current) return;

    const payload: CreateDemandTemplateInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      defaultPriority,
      estimatedDays: Number(estimatedDays),
      tasks: tasks.map((t, idx) => ({
        tempId: t.tempId,
        title: t.title.trim(),
        description: t.description.trim(),
        suggestedRole: t.suggestedRole,
        priority: t.priority,
        dayOffsetStart: Number(t.dayOffsetStart),
        durationDays: Number(t.durationDays),
        orderIndex: idx,
        dependsOnTempIds: [],
        requirements: t.requirements
          .filter((r) => r.title.trim().length > 0)
          .map((r, ri) => ({
            title: r.title.trim(),
            mandatory: r.mandatory,
            orderIndex: ri,
          })),
      })),
    };

    const validation = createDemandTemplateInputSchema.safeParse(payload);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      setFormError(issue?.message || 'Verifique os dados preenchidos no template.');
      return;
    }

    submitRef.current = true;
    setFormBusy(true);
    setFormError(null);

    const controller = new AbortController();
    try {
      const response = await api.createDemandTemplate(
        validation.data,
        controller.signal,
        onUnauthorized,
      );
      setActionNotice(`Template "${response.template.title}" criado com sucesso!`);
      // Reset form
      setTitle('');
      setDescription('');
      setCategory('general');
      setDefaultPriority('normal');
      setEstimatedDays(5);
      setTasks([emptyTaskDraft(1)]);
      setMode('list');
      void loadTemplates();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setFormError('Você não tem permissão para criar templates.');
      } else {
        setFormError('Falha ao salvar template. Verifique os dados e tente novamente.');
      }
    } finally {
      submitRef.current = false;
      setFormBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manage-templates-title">
      <div className="modal-card wide">
        <div className="modal-header">
          <h2 id="manage-templates-title">
            {mode === 'create' ? 'Novo template de demanda' : 'Gerenciar templates de demandas'}
          </h2>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            aria-label="Fechar janela"
            disabled={formBusy}
          >
            ✕
          </button>
        </div>

        {actionNotice && (
          <div className="alert-banner success" role="status" style={{ margin: '16px 24px 0' }}>
            <span>{actionNotice}</span>
            <button
              type="button"
              className="close-alert"
              onClick={() => setActionNotice(null)}
              aria-label="Fechar aviso"
            >
              ✕
            </button>
          </div>
        )}

        {mode === 'list' ? (
          <div className="modal-body">
            <div className="panel-actions" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
              <span className="muted-text">
                Templates agilizam a abertura de chamados padronizados com tarefas, prazos e checklists pré-configurados.
              </span>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setMode('create');
                  setFormError(null);
                }}
              >
                + Novo template
              </button>
            </div>

            {listError && (
              <div className="alert-banner error" role="alert" style={{ marginBottom: 16 }}>
                <span>{listError}</span>
              </div>
            )}

            {loading ? (
              <div className="empty-state" aria-live="polite">
                <p className="status-text">Carregando templates…</p>
              </div>
            ) : templates.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">Nenhum template cadastrado.</p>
                <p className="empty-description">Crie o primeiro template para padronizar as entregas da equipe.</p>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table" aria-label="Tabela de templates de demandas">
                  <thead>
                    <tr>
                      <th scope="col">Título</th>
                      <th scope="col">Categoria</th>
                      <th scope="col">Prioridade padrão</th>
                      <th scope="col">Tarefas</th>
                      <th scope="col">Estimativa</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((tpl) => (
                      <tr key={tpl.id}>
                        <td>
                          <div className="demand-title">{tpl.title}</div>
                          <div className="client-notes">{tpl.description || 'Sem descrição'}</div>
                        </td>
                        <td>
                          <span className="badge category-badge">{categoryLabels[tpl.category]}</span>
                        </td>
                        <td>
                          <span className={`priority-badge ${tpl.defaultPriority}`}>
                            {priorityLabels[tpl.defaultPriority]}
                          </span>
                        </td>
                        <td>{tpl.tasks.length} tarefa(s)</td>
                        <td>~{tpl.estimatedDays} dia(s)</td>
                        <td>
                          <span className={`status-badge ${tpl.active ? 'complete' : 'muted'}`}>
                            {tpl.active ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                            onClick={() => void handleToggleActive(tpl)}
                          >
                            {tpl.active ? 'Desativar' : 'Ativar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="panel-actions" style={{ marginTop: 24 }}>
              <button type="button" className="secondary-button" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleCreateTemplate(e)} noValidate className="modal-body">
            {formError && (
              <div className="alert-banner error" role="alert" style={{ marginBottom: 16 }}>
                <span>{formError}</span>
              </div>
            )}

            <div className="form-field">
              <label htmlFor="tpl-create-title">Título do template *</label>
              <input
                id="tpl-create-title"
                type="text"
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Criação de Landing Page Completa"
                required
                disabled={formBusy}
              />
            </div>

            <div className="form-field">
              <label htmlFor="tpl-create-desc">Descrição geral</label>
              <textarea
                id="tpl-create-desc"
                rows={2}
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição dos objetivos e escopo deste tipo de demanda…"
                disabled={formBusy}
              />
            </div>

            <div className="form-row">
              <div className="form-field">
                <label htmlFor="tpl-create-cat">Categoria *</label>
                <select
                  id="tpl-create-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DemandTemplateCategory)}
                  disabled={formBusy}
                >
                  {(Object.keys(categoryLabels) as DemandTemplateCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {categoryLabels[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="tpl-create-prio">Prioridade padrão</label>
                <select
                  id="tpl-create-prio"
                  value={defaultPriority}
                  onChange={(e) => setDefaultPriority(e.target.value as DemandPriority)}
                  disabled={formBusy}
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="tpl-create-est">Estimativa total (dias) *</label>
                <input
                  id="tpl-create-est"
                  type="number"
                  min={1}
                  max={365}
                  value={estimatedDays}
                  onChange={(e) => setEstimatedDays(Math.max(1, Number(e.target.value)))}
                  required
                  disabled={formBusy}
                />
              </div>
            </div>

            {/* Tasks section */}
            <div className="template-tasks-section" style={{ marginTop: 20 }}>
              <div className="section-heading-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="section-heading" style={{ fontSize: '1rem', margin: 0 }}>
                  Tarefas do template ({tasks.length})
                </h3>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                  onClick={handleAddTask}
                  disabled={formBusy}
                >
                  + Adicionar tarefa
                </button>
              </div>

              <div className="template-tasks-draft-list" style={{ marginTop: 12 }}>
                {tasks.map((task, tIndex) => (
                  <div key={task.tempId} className="template-task-draft-card">
                    <div className="draft-header">
                      <span className="task-preview-index">#{tIndex + 1}</span>
                      <div className="form-field" style={{ flex: 1, margin: 0 }}>
                        <input
                          type="text"
                          maxLength={160}
                          value={task.title}
                          onChange={(e) => handleUpdateTask(tIndex, 'title', e.target.value)}
                          placeholder="Título da tarefa *"
                          required
                          disabled={formBusy}
                        />
                      </div>
                      {tasks.length > 1 && (
                        <button
                          type="button"
                          className="text-button danger"
                          onClick={() => handleRemoveTask(tIndex)}
                          disabled={formBusy}
                          aria-label={`Remover tarefa ${tIndex + 1}`}
                        >
                          ✕ Remover
                        </button>
                      )}
                    </div>

                    <div className="draft-body">
                      <div className="form-row">
                        <div className="form-field">
                          <label>Papel sugerido</label>
                          <select
                            value={task.suggestedRole}
                            onChange={(e) =>
                              handleUpdateTask(tIndex, 'suggestedRole', e.target.value as Role)
                            }
                            disabled={formBusy}
                          >
                            <option value="collaborator">Colaborador</option>
                            <option value="administrator">Administrador</option>
                          </select>
                        </div>
                        <div className="form-field">
                          <label>Prioridade</label>
                          <select
                            value={task.priority}
                            onChange={(e) =>
                              handleUpdateTask(tIndex, 'priority', e.target.value as TaskPriority)
                            }
                            disabled={formBusy}
                          >
                            <option value="low">Baixa</option>
                            <option value="normal">Normal</option>
                            <option value="high">Alta</option>
                            <option value="urgent">Urgente</option>
                          </select>
                        </div>
                        <div className="form-field">
                          <label>Início (+dias)</label>
                          <input
                            type="number"
                            min={0}
                            value={task.dayOffsetStart}
                            onChange={(e) =>
                              handleUpdateTask(tIndex, 'dayOffsetStart', Math.max(0, Number(e.target.value)))
                            }
                            disabled={formBusy}
                          />
                        </div>
                        <div className="form-field">
                          <label>Duração (dias)</label>
                          <input
                            type="number"
                            min={1}
                            value={task.durationDays}
                            onChange={(e) =>
                              handleUpdateTask(tIndex, 'durationDays', Math.max(1, Number(e.target.value)))
                            }
                            disabled={formBusy}
                          />
                        </div>
                      </div>

                      {/* Requirements checklist draft */}
                      <div className="draft-requirements" style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Requisitos desta tarefa:</span>
                          <button
                            type="button"
                            className="text-button"
                            style={{ fontSize: '0.78rem' }}
                            onClick={() => handleAddRequirement(tIndex)}
                            disabled={formBusy}
                          >
                            + Adicionar requisito
                          </button>
                        </div>
                        {task.requirements.map((req, rIndex) => (
                          <div key={rIndex} className="draft-req-row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                            <input
                              type="text"
                              maxLength={200}
                              value={req.title}
                              onChange={(e) => handleUpdateRequirement(tIndex, rIndex, 'title', e.target.value)}
                              placeholder="Descrição do requisito…"
                              style={{ flex: 1, fontSize: '0.82rem', padding: '4px 8px' }}
                              disabled={formBusy}
                            />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={req.mandatory}
                                onChange={(e) => handleUpdateRequirement(tIndex, rIndex, 'mandatory', e.target.checked)}
                                disabled={formBusy}
                              />
                              Obrigatório
                            </label>
                            <button
                              type="button"
                              className="text-button danger"
                              style={{ fontSize: '0.78rem', padding: '0 4px' }}
                              onClick={() => handleRemoveRequirement(tIndex, rIndex)}
                              disabled={formBusy}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-actions" style={{ marginTop: 24 }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setMode('list')}
                disabled={formBusy}
              >
                Voltar à lista
              </button>
              <button type="submit" className="primary-button" disabled={formBusy}>
                {formBusy ? 'Salvando…' : 'Salvar template'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
