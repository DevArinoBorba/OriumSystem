import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createTaskSchema, type Demand, type Task } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { showToast } from './Toasts.js';
import { taskStatusLabel } from '../taskStatus.js';
import type { TaskFormState, UserListItem } from '../types.js';

interface CreateTaskFormProps {
  /** Id do usuário logado, marcado como "(você)" na lista de responsáveis. */
  currentUserId: string;
  demand: Demand;
  tasks: Task[];
  users: UserListItem[];
  usersLoaded: boolean;
  onClose: () => void;
  onCreated: () => void;
  onUnauthorized: () => void;
}

const emptyTaskForm = (deliveryDate: string): TaskFormState => ({
  assignedToUserId: '',
  title: '',
  description: '',
  priority: 'normal',
  deliveryDate,
  requirements: [{ title: '', mandatory: false }],
  dependsOnTaskIds: [],
});

/** Formulário "Nova tarefa" (admin). Montado só enquanto aberto; a entrega começa igual à do chamado. */
export function CreateTaskForm({ currentUserId, demand, tasks, users, usersLoaded, onClose, onCreated, onUnauthorized }: CreateTaskFormProps) {
  const [taskForm, setTaskForm] = useState<TaskFormState>(() => emptyTaskForm(demand.deliveryDate));
  const [taskFormBusy, setTaskFormBusy] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);
  const taskFormSubmittingRef = useRef(false);
  const assigneeInputRef = useRef<HTMLSelectElement>(null);
  const taskTitleInputRef = useRef<HTMLInputElement>(null);

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
      showToast(`Tarefa "${created.title}" criada com sucesso.`);
      onCreated();
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

  return (
    <section className="inline-panel" aria-labelledby="task-form-heading">
      <div className="panel-header">
        <h2 id="task-form-heading">Nova tarefa</h2>
        <button
          type="button"
          className="close-button"
          onClick={() => onClose()}
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
                  {u.name} {u.id === currentUserId ? '(você)' : ''}
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
          <button type="button" className="secondary-button" onClick={() => onClose()} disabled={taskFormBusy}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={taskFormBusy}>
            {taskFormBusy ? 'Criando…' : 'Criar tarefa'}
          </button>
        </div>
      </form>
    </section>
  );
}
