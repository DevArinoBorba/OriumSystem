import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createDemandSchema, type Client, type Demand } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { showToast } from './Toasts.js';
import type { DemandFormState } from '../types.js';

interface CreateDemandModalProps {
  clients: Client[];
  clientsLoaded: boolean;
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

/** Modal "Novo chamado" (admin). Montado só enquanto aberto, então o rascunho começa vazio. */
export function CreateDemandModal({ clients, clientsLoaded, onClose, onCreated, onUnauthorized }: CreateDemandModalProps) {
  const [demandForm, setDemandForm] = useState<DemandFormState>(emptyDemandForm);
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
      showToast(`${created.title} criado com sucesso.`);
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
          <h2 id="demand-form-heading">Novo chamado</h2>
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
            <button type="button" className="secondary-button" onClick={() => onClose()} disabled={demandFormBusy}>
              Cancelar
            </button>
            <button type="submit" className="primary-button" disabled={demandFormBusy}>
              {demandFormBusy ? 'Criando…' : 'Abrir chamado'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
