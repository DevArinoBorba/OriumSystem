import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createDemandSchema, type Client, type Demand } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { showToast } from './Toasts.js';
import type { DemandFormState, UserListItem } from '../types.js';

interface CreateDemandModalProps {
  currentUserId: string;
  clients: Client[];
  clientsLoaded: boolean;
  users: UserListItem[];
  usersLoaded: boolean;
  onClose: () => void;
  onCreated: (demand: Demand) => void;
  onUnauthorized: () => void;
}

const emptyDemandForm = (): DemandFormState => ({
  clientId: '',
  title: '',
  description: '',
  priority: 'normal',
  deliveryDate: '',
});

/** Modal "Nova demanda" unificado (inclui responsável e checklist da demanda). */
export function CreateDemandModal({
  currentUserId,
  clients,
  clientsLoaded,
  users,
  usersLoaded,
  onClose,
  onCreated,
  onUnauthorized,
}: CreateDemandModalProps) {
  const [demandForm, setDemandForm] = useState<DemandFormState>(emptyDemandForm);
  const [assignedToUserId, setAssignedToUserId] = useState<string>(currentUserId);
  const [requirements, setRequirements] = useState<Array<{ title: string; mandatory: boolean }>>([]);
  const [demandFormBusy, setDemandFormBusy] = useState(false);
  const [demandFormError, setDemandFormError] = useState<string | null>(null);
  const demandFormSubmittingRef = useRef(false);
  const demandTitleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !demandFormBusy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [demandFormBusy, onClose]);

  function addRequirement() {
    setRequirements((prev) => [...prev, { title: '', mandatory: false }]);
  }

  function updateRequirement(index: number, patch: Partial<{ title: string; mandatory: boolean }>) {
    setRequirements((prev) => {
      const next = [...prev];
      const current = next[index] ?? { title: '', mandatory: false };
      next[index] = { ...current, ...patch };
      return next;
    });
  }

  function removeRequirement(index: number) {
    setRequirements((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function handleCreateDemand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demandFormSubmittingRef.current) return;
    demandFormSubmittingRef.current = true;
    setDemandFormBusy(true);
    setDemandFormError(null);

    const cleanRequirements = requirements
      .filter((r) => r.title.trim().length > 0)
      .map((r) => ({ title: r.title.trim(), mandatory: r.mandatory }));

    const payload = {
      clientId: demandForm.clientId,
      title: demandForm.title.trim(),
      description: demandForm.description.trim(),
      priority: demandForm.priority,
      deliveryDate: demandForm.deliveryDate,
      assignedToUserId: assignedToUserId || currentUserId,
      ...(cleanRequirements.length > 0 ? { requirements: cleanRequirements } : {}),
    };
    const validation = createDemandSchema.safeParse(payload);
    if (!validation.success) {
      const firstIssue = validation.error.issues[0];
      const fieldName = firstIssue?.path[0] as string | undefined;
      if (fieldName === 'clientId') {
        setDemandFormError('Selecione o cliente da demanda.');
      } else if (fieldName === 'title') {
        demandTitleInputRef.current?.focus();
        setDemandFormError('O título da demanda é obrigatório (1 a 160 caracteres).');
      } else if (fieldName === 'description') {
        setDemandFormError('A descrição não pode exceder 5000 caracteres.');
      } else if (fieldName === 'deliveryDate') {
        setDemandFormError('Informe a data de entrega da demanda.');
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
      showToast(`Demanda "${created.title}" criada com sucesso.`);
      onCreated(created);
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

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demand-form-heading"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !demandFormBusy) {
          onClose();
        }
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="demand-form-heading">Nova demanda</h2>
          <button
            type="button"
            className="close-button"
            onClick={() => onClose()}
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

          <div className="form-row">
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
              <label htmlFor="demand-form-assignee">Responsável *</label>
              <select
                id="demand-form-assignee"
                value={assignedToUserId}
                onChange={(event) => setAssignedToUserId(event.target.value)}
                disabled={demandFormBusy}
                required
              >
                {users.length === 0 ? (
                  <option value={currentUserId}>
                    {usersLoaded ? 'Você (responsável padrão)' : 'Carregando equipe…'}
                  </option>
                ) : (
                  users
                    .filter((u) => u.active)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} {user.id === currentUserId ? '(você)' : ''}
                      </option>
                    ))
                )}
              </select>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="demand-form-title">Título da demanda *</label>
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
            <label htmlFor="demand-form-description">Descrição / Briefing</label>
            <textarea
              id="demand-form-description"
              rows={4}
              placeholder="Contexto, referências e orientações da demanda…"
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
                Data de entrega *
              </label>
              <input
                id="demand-form-date"
                type="date"
                value={demandForm.deliveryDate}
                onChange={(event) => setDemandForm({ ...demandForm, deliveryDate: event.target.value })}
                required
                disabled={demandFormBusy}
              />
              <span className="muted-text">Defina o prazo de entrega da demanda.</span>
            </div>
          </div>

          <div className="form-field">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ marginBottom: 0 }}>Checklist / Requisitos (opcional)</label>
              <button
                type="button"
                className="text-button"
                onClick={addRequirement}
                disabled={demandFormBusy || requirements.length >= 30}
              >
                + Adicionar item
              </button>
            </div>
            {requirements.map((req, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <input
                  type="text"
                  placeholder={`Item ${idx + 1} do checklist…`}
                  maxLength={160}
                  value={req.title}
                  onChange={(e) => updateRequirement(idx, { title: e.target.value })}
                  disabled={demandFormBusy}
                  style={{ flex: 1 }}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', whiteSpace: 'nowrap', marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={req.mandatory}
                    onChange={(e) => updateRequirement(idx, { mandatory: e.target.checked })}
                    disabled={demandFormBusy}
                  />
                  Obrigatório
                </label>
                <button
                  type="button"
                  className="close-button"
                  onClick={() => removeRequirement(idx)}
                  disabled={demandFormBusy}
                  aria-label="Remover item"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => onClose()} disabled={demandFormBusy}>
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={demandFormBusy}>
              {demandFormBusy ? 'Criando…' : 'Criar demanda'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
