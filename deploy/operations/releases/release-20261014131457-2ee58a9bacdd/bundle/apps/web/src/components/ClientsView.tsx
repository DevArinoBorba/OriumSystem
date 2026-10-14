import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createClientSchema,
  updateClientSchema,
  type Client,
  type SessionResponse,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';
import type { ClientFormState, ClientsFilterStatus } from '../types.js';

interface ClientsViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  onOpenMaterials?: (target: { clientId: string }) => void;
}

const emptyForm: ClientFormState = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  notes: '',
};

export function ClientsView({ session, onUnauthorized, onOpenMaterials }: ClientsViewProps) {
  const hasWrite = session.permissions.includes('clients.write');
  const hasArchive = session.permissions.includes('clients.archive');
  const hasMaterialsRead = session.permissions.includes('materials.read');

  // List & Filter State
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [status, setStatus] = useState<ClientsFilterStatus>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Form State (Create / Edit Inline Panel)
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formState, setFormState] = useState<ClientFormState>(emptyForm);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState<boolean>(false);
  const isFormSubmittingRef = useRef(false);
  const isActionBusyRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const contactNameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLTextAreaElement>(null);

  // Archive Confirmation Dialog State
  const [clientToArchive, setClientToArchive] = useState<Client | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const archiveDialogRef = useRef<HTMLDialogElement>(null);

  const activeRequestRef = useRef<AbortController | null>(null);

  const loadClients = useCallback(
    async (currentPage: number, currentStatus: ClientsFilterStatus, q: string) => {
      activeRequestRef.current?.abort();
      const controller = new AbortController();
      activeRequestRef.current = controller;

      setLoading(true);
      setListError(null);

      try {
        const response = await api.listClients(
          { q: q.trim(), status: currentStatus, page: currentPage, pageSize },
          controller.signal,
          onUnauthorized,
        );
        if (activeRequestRef.current === controller && !controller.signal.aborted) {
          setClients(response.clients);
          setTotal(response.total);

          // If page > 1 and result is empty (e.g. after archiving last item on a page), step back
          if (response.clients.length === 0 && currentPage > 1) {
            setPage((prev) => Math.max(1, prev - 1));
          }
        }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (activeRequestRef.current === controller) {
          if (error instanceof ApiError && error.status === 403) {
            setListError('Você não tem permissão para visualizar clientes.');
          } else {
            setListError('Não foi possível carregar a lista de clientes. Tente novamente.');
          }
        }
      } finally {
        if (activeRequestRef.current === controller) {
          setLoading(false);
          activeRequestRef.current = null;
        }
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void loadClients(page, status, appliedSearch);
    return () => {
      activeRequestRef.current?.abort();
    };
  }, [page, status, appliedSearch, loadClients]);

  // Focus on name input when form opens
  useEffect(() => {
    if (formOpen) {
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }
  }, [formOpen]);

  // Native dialog lifecycle management
  useEffect(() => {
    const dialog = archiveDialogRef.current;
    if (!dialog) return;
    if (clientToArchive) {
      setArchiveError(null);
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [clientToArchive]);

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

  function openCreateForm() {
    setEditingClient(null);
    setFormState(emptyForm);
    setFormError(null);
    setVersionConflict(false);
    setFormOpen(true);
  }

  function openEditForm(client: Client) {
    setEditingClient(client);
    setFormState({
      id: client.id,
      version: client.version,
      name: client.name,
      contactName: client.contactName ?? '',
      email: client.email ?? '',
      phone: client.phone ?? '',
      notes: client.notes ?? '',
    });
    setFormError(null);
    setVersionConflict(false);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingClient(null);
    setFormState(emptyForm);
    setFormError(null);
    setVersionConflict(false);
  }

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isFormSubmittingRef.current) return;
    isFormSubmittingRef.current = true;
    setFormBusy(true);
    setFormError(null);

    if (editingClient) {
      // Update Client
      const payload = {
        version: editingClient.version,
        name: formState.name.trim(),
        contactName: formState.contactName.trim() || null,
        email: formState.email.trim().toLowerCase() || null,
        phone: formState.phone.trim() || null,
        notes: formState.notes.trim() || null,
      };

      const validation = updateClientSchema.safeParse(payload);
      if (!validation.success) {
        const firstIssue = validation.error.issues[0];
        const fieldName = firstIssue?.path[0] as string | undefined;
        let errorMessage = firstIssue?.message || 'Verifique os dados preenchidos.';
        if (fieldName === 'name') {
          errorMessage = 'O nome do cliente é obrigatório (1 a 160 caracteres).';
          nameInputRef.current?.focus();
        } else if (fieldName === 'contactName') {
          errorMessage = 'O nome do contato não pode exceder 160 caracteres.';
          contactNameInputRef.current?.focus();
        } else if (fieldName === 'email') {
          errorMessage = 'Informe um e-mail válido (ex: contato@exemplo.com) com até 254 caracteres.';
          emailInputRef.current?.focus();
        } else if (fieldName === 'phone') {
          errorMessage = 'O telefone não pode exceder 40 caracteres.';
          phoneInputRef.current?.focus();
        } else if (fieldName === 'notes') {
          errorMessage = 'As observações não podem exceder 4000 caracteres.';
          notesInputRef.current?.focus();
        }
        setFormError(errorMessage);
        isFormSubmittingRef.current = false;
        setFormBusy(false);
        return;
      }

      const controller = new AbortController();
      try {
        await api.updateClient(editingClient.id, validation.data, controller.signal, onUnauthorized);
        setNoticeMessage(`Cliente "${formState.name.trim()}" atualizado com sucesso.`);
        closeForm();
        void loadClients(page, status, appliedSearch);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'CLIENT_VERSION_CONFLICT') {
          setVersionConflict(true);
          setFormError(
            'Conflito de versão: este cliente foi alterado por outro usuário ou processo enquanto você editava.',
          );
        } else if (error instanceof ApiError && error.status === 403) {
          setFormError('Você não tem permissão para editar clientes.');
        } else {
          setFormError('Não foi possível salvar as alterações. Verifique os dados e tente novamente.');
        }
      } finally {
        isFormSubmittingRef.current = false;
        setFormBusy(false);
      }
    } else {
      // Create Client
      const payload = {
        name: formState.name.trim(),
        contactName: formState.contactName.trim() || undefined,
        email: formState.email.trim().toLowerCase() || undefined,
        phone: formState.phone.trim() || undefined,
        notes: formState.notes.trim() || undefined,
      };

      const validation = createClientSchema.safeParse(payload);
      if (!validation.success) {
        const firstIssue = validation.error.issues[0];
        const fieldName = firstIssue?.path[0] as string | undefined;
        let errorMessage = firstIssue?.message || 'Verifique os dados preenchidos.';
        if (fieldName === 'name') {
          errorMessage = 'O nome do cliente é obrigatório (1 a 160 caracteres).';
          nameInputRef.current?.focus();
        } else if (fieldName === 'contactName') {
          errorMessage = 'O nome do contato não pode exceder 160 caracteres.';
          contactNameInputRef.current?.focus();
        } else if (fieldName === 'email') {
          errorMessage = 'Informe um e-mail válido (ex: contato@exemplo.com) com até 254 caracteres.';
          emailInputRef.current?.focus();
        } else if (fieldName === 'phone') {
          errorMessage = 'O telefone não pode exceder 40 caracteres.';
          phoneInputRef.current?.focus();
        } else if (fieldName === 'notes') {
          errorMessage = 'As observações não podem exceder 4000 caracteres.';
          notesInputRef.current?.focus();
        }
        setFormError(errorMessage);
        isFormSubmittingRef.current = false;
        setFormBusy(false);
        return;
      }

      const controller = new AbortController();
      try {
        await api.createClient(validation.data, controller.signal, onUnauthorized);
        setNoticeMessage(`Cliente "${formState.name.trim()}" cadastrado com sucesso.`);
        closeForm();
        if (page !== 1) {
          setPage(1);
        } else {
          void loadClients(1, status, appliedSearch);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          setFormError('Você não tem permissão para cadastrar clientes.');
        } else {
          setFormError('Não foi possível cadastrar o cliente. Tente novamente.');
        }
      } finally {
        isFormSubmittingRef.current = false;
        setFormBusy(false);
      }
    }
  }

  async function reloadLatestVersion() {
    if (isFormSubmittingRef.current || !editingClient) return;
    isFormSubmittingRef.current = true;
    setFormBusy(true);
    setFormError(null);
    const controller = new AbortController();
    try {
      const response = await api.getClient(editingClient.id, controller.signal, onUnauthorized);
      const latest = response.client;
      setEditingClient(latest);
      setFormState({
        id: latest.id,
        version: latest.version,
        name: latest.name,
        contactName: latest.contactName ?? '',
        email: latest.email ?? '',
        phone: latest.phone ?? '',
        notes: latest.notes ?? '',
      });
      setVersionConflict(false);
      setNoticeMessage(`Versão mais recente (${latest.version}) carregada do servidor. O rascunho anterior foi descartado.`);
    } catch {
      setFormError('Não foi possível obter a versão mais recente do cliente.');
    } finally {
      isFormSubmittingRef.current = false;
      setFormBusy(false);
    }
  }

  async function handleArchiveConfirm() {
    if (isActionBusyRef.current || !clientToArchive) return;
    isActionBusyRef.current = true;
    setActionBusy(true);
    setArchiveError(null);
    const controller = new AbortController();
    try {
      await api.archiveClient(clientToArchive.id, clientToArchive.version, controller.signal, onUnauthorized);
      setNoticeMessage(`Cliente "${clientToArchive.name}" arquivado com sucesso.`);
      setClientToArchive(null);
      void loadClients(page, status, appliedSearch);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CLIENT_VERSION_CONFLICT') {
        setArchiveError('Este cliente foi modificado recentemente. Feche esta caixa e recarregue a lista.');
      } else {
        setArchiveError('Não foi possível arquivar o cliente. Tente novamente.');
      }
    } finally {
      isActionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  async function handleRestore(client: Client) {
    if (isActionBusyRef.current) return;
    isActionBusyRef.current = true;
    setActionBusy(true);
    const controller = new AbortController();
    try {
      await api.restoreClient(client.id, client.version, controller.signal, onUnauthorized);
      setNoticeMessage(`Cliente "${client.name}" restaurado com sucesso.`);
      void loadClients(page, status, appliedSearch);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CLIENT_VERSION_CONFLICT') {
        setNoticeMessage('Este cliente foi modificado recentemente. A lista foi atualizada.');
        void loadClients(page, status, appliedSearch);
      } else {
        setNoticeMessage('Não foi possível restaurar o cliente. Tente novamente.');
      }
    } finally {
      isActionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="view-panel" aria-labelledby="clients-heading">
      <div className="panel-header">
        <div>
          <h1 id="clients-heading">Clientes</h1>
          <p className="panel-subtitle">Gerencie o cadastro, contatos e histórico de clientes da agência.</p>
        </div>
        {hasWrite && (
          <button
            type="button"
            className="primary-button"
            onClick={openCreateForm}
            disabled={loading || formOpen}
          >
            + Novo cliente
          </button>
        )}
      </div>

      {noticeMessage && (
        <div className="alert-banner success" role="status">
          <span>{noticeMessage}</span>
          <button type="button" className="close-alert" onClick={() => setNoticeMessage(null)} aria-label="Fechar aviso">
            ✕
          </button>
        </div>
      )}

      {/* Inline Form Panel for Create / Edit */}
      {formOpen && (
        <section className="inline-panel" aria-labelledby="form-panel-title">
          <div className="panel-header">
            <h2 id="form-panel-title">{editingClient ? 'Editar cliente' : 'Novo cliente'}</h2>
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

          <form onSubmit={(event) => void handleFormSubmit(event)} noValidate>
            {formError && (
              <div className="alert-banner error" role="alert">
                <span>{formError}</span>
                {versionConflict && (
                  <div className="conflict-resolution" style={{ marginTop: 8 }}>
                    <p style={{ margin: '0 0 8px 0', fontSize: '0.875rem' }}>
                      Atenção: ao carregar os dados mais recentes do servidor, o seu rascunho atual com as alterações não salvas será descartado.
                    </p>
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

            <div className="form-field">
              <label htmlFor="client-form-name">Nome do cliente *</label>
              <input
                ref={nameInputRef}
                id="client-form-name"
                type="text"
                maxLength={160}
                value={formState.name}
                onChange={(event) => setFormState({ ...formState, name: event.target.value })}
                required
                disabled={formBusy}
              />
            </div>

            <div className="form-field">
              <label htmlFor="client-form-contact">Nome do contato</label>
              <input
                ref={contactNameInputRef}
                id="client-form-contact"
                type="text"
                maxLength={160}
                value={formState.contactName}
                onChange={(event) => setFormState({ ...formState, contactName: event.target.value })}
                disabled={formBusy}
              />
            </div>

            <div className="form-row">
              <div className="form-field">
                <label htmlFor="client-form-email">E-mail</label>
                <input
                  ref={emailInputRef}
                  id="client-form-email"
                  type="email"
                  maxLength={254}
                  value={formState.email}
                  onChange={(event) => setFormState({ ...formState, email: event.target.value })}
                  disabled={formBusy}
                />
              </div>
              <div className="form-field">
                <label htmlFor="client-form-phone">Telefone</label>
                <input
                  ref={phoneInputRef}
                  id="client-form-phone"
                  type="tel"
                  maxLength={40}
                  value={formState.phone}
                  onChange={(event) => setFormState({ ...formState, phone: event.target.value })}
                  disabled={formBusy}
                />
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="client-form-notes">Observações</label>
              <textarea
                ref={notesInputRef}
                id="client-form-notes"
                rows={4}
                maxLength={4000}
                value={formState.notes}
                onChange={(event) => setFormState({ ...formState, notes: event.target.value })}
                disabled={formBusy}
              />
            </div>

            <div className="panel-actions">
              <button type="button" className="secondary-button" onClick={closeForm} disabled={formBusy}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={formBusy}>
                {formBusy ? 'Salvando…' : editingClient ? 'Salvar alterações' : 'Cadastrar cliente'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Toolbar: Search and Filter */}
      <div className="toolbar">
        <form className="search-form" onSubmit={handleSearchSubmit} role="search">
          <label htmlFor="client-search" className="sr-only">
            Pesquisar clientes
          </label>
          <input
            id="client-search"
            type="search"
            placeholder="Pesquisar por nome, contato ou e-mail…"
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
          {(['active', 'archived', 'all'] as const).map((s) => (
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
              {s === 'active' ? 'Ativos' : s === 'archived' ? 'Arquivados' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {/* Data Table / Content */}
      {loading ? (
        <div className="empty-state" aria-live="polite">
          <p className="status-text">Carregando clientes…</p>
        </div>
      ) : listError ? (
        <div className="empty-state error" role="alert">
          <p className="error-text">{listError}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadClients(page, status, appliedSearch)}
          >
            Tentar novamente
          </button>
        </div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          {appliedSearch ? (
            <>
              <p className="empty-title">Nenhum cliente encontrado para a pesquisa informada.</p>
              <p className="empty-description">Tente pesquisar com outro termo ou limpe o filtro de busca.</p>
              <button type="button" className="secondary-button" onClick={handleClearSearch}>
                Limpar pesquisa
              </button>
            </>
          ) : status === 'archived' ? (
            <p className="empty-title">Nenhum cliente arquivado no momento.</p>
          ) : (
            <>
              <p className="empty-title">Nenhum cliente cadastrado ainda.</p>
              <p className="empty-description">Comece cadastrando o primeiro cliente da agência.</p>
              {hasWrite && (
                <button type="button" className="primary-button" onClick={openCreateForm}>
                  + Novo cliente
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="data-table" aria-label="Tabela de clientes">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Contato</th>
                  <th scope="col">E-mail / Telefone</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const isArchived = Boolean(client.archivedAt);
                  return (
                    <tr key={client.id} className={isArchived ? 'row-archived' : ''}>
                      <td>
                        <div className="client-name">{client.name}</div>
                        {client.notes && <div className="client-notes">{client.notes}</div>}
                      </td>
                      <td>{client.contactName || <span className="muted-dash">—</span>}</td>
                      <td>
                        <div className="contact-info">
                          {client.email && <div>{client.email}</div>}
                          {client.phone && <div className="client-phone">{client.phone}</div>}
                          {!client.email && !client.phone && <span className="muted-dash">—</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge ${isArchived ? 'archived' : 'active'}`}>
                          {isArchived ? 'Arquivado' : 'Ativo'}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="action-buttons">
                          {onOpenMaterials && hasMaterialsRead && (
                            <button
                              type="button"
                              className="action-btn secondary"
                              onClick={() => onOpenMaterials({ clientId: client.id })}
                              disabled={actionBusy}
                              title={`Ver materiais de ${client.name}`}
                            >
                              Materiais
                            </button>
                          )}
                          {hasWrite && (
                            <button
                              type="button"
                              className="action-btn edit"
                              onClick={() => openEditForm(client)}
                              disabled={actionBusy}
                            >
                              Editar
                            </button>
                          )}
                          {hasArchive && (
                            isArchived ? (
                              <button
                                type="button"
                                className="action-btn restore"
                                onClick={() => void handleRestore(client)}
                                disabled={actionBusy}
                              >
                                Restaurar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="action-btn archive"
                                onClick={() => setClientToArchive(client)}
                                disabled={actionBusy}
                              >
                                Arquivar
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination-bar">
            <span className="pagination-info">
              Página {page} de {totalPages} ({total} {total === 1 ? 'cliente' : 'clientes'} no total)
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
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}

      {/* Native Dialog for Archive Confirmation */}
      <dialog
        ref={archiveDialogRef}
        className="native-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!isActionBusyRef.current) {
              setClientToArchive(null);
              setArchiveError(null);
            }
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!actionBusy) {
            setClientToArchive(null);
            setArchiveError(null);
          }
        }}
      >
        <div className="dialog-header">
          <h2>Confirmar arquivamento</h2>
          <button
            type="button"
            className="close-button"
            onClick={() => {
              setClientToArchive(null);
              setArchiveError(null);
            }}
            aria-label="Cancelar arquivamento"
            disabled={actionBusy}
          >
            ✕
          </button>
        </div>
        <div className="dialog-body">
          {archiveError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: 12 }}>
              <span>{archiveError}</span>
            </div>
          )}
          <p>
            Deseja realmente arquivar o cliente <strong>&ldquo;{clientToArchive?.name}&rdquo;</strong>?
          </p>
          <p className="muted-text">
            Os dados serão preservados no sistema e o cliente poderá ser restaurado a qualquer momento através do filtro de arquivados.
          </p>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setClientToArchive(null);
              setArchiveError(null);
            }}
            disabled={actionBusy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void handleArchiveConfirm()}
            disabled={actionBusy}
          >
            {actionBusy ? 'Arquivando…' : 'Sim, arquivar cliente'}
          </button>
        </div>
      </dialog>
    </section>
  );
}
