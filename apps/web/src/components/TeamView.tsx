import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createUserSchema, type Role, type SessionResponse } from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { showToast } from './Toasts.js';
import type { UserListItem } from '../types.js';
import { PasswordVisibilityButton } from './PasswordVisibilityButton.js';

interface TeamViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
}

export function TeamView({ session, onUnauthorized }: TeamViewProps) {
  const hasCreate = session.permissions.includes('users.create');
  const hasDeactivate = session.permissions.includes('users.deactivate');
  const hasManageRoles = session.permissions.includes('roles.manage');

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Create User Form State (Inline Panel)
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState<Role>('collaborator');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const isFormSubmittingRef = useRef(false);
  const isActionBusyRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Deactivate Confirmation Dialog State
  const [userToDeactivate, setUserToDeactivate] = useState<UserListItem | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const deactivateDialogRef = useRef<HTMLDialogElement>(null);

  // Role Change Confirmation Dialog State
  const [userToChangeRole, setUserToChangeRole] = useState<{ user: UserListItem; targetRole: Role } | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const roleDialogRef = useRef<HTMLDialogElement>(null);

  const activeRequestRef = useRef<AbortController | null>(null);

  const loadUsers = useCallback(async () => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;

    setLoading(true);
    setListError(null);

    try {
      const response = await api.listUsers(controller.signal, onUnauthorized);
      if (activeRequestRef.current === controller && !controller.signal.aborted) {
        setUsers(response.users);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      if (activeRequestRef.current === controller) {
        if (error instanceof ApiError && error.status === 403) {
          setListError('Você não tem permissão para visualizar os membros da equipe.');
        } else {
          setListError('Não foi possível carregar a lista de equipe. Tente novamente.');
        }
      }
    } finally {
      if (activeRequestRef.current === controller) {
        setLoading(false);
        activeRequestRef.current = null;
      }
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadUsers();
    return () => {
      activeRequestRef.current?.abort();
    };
  }, [loadUsers]);

  // Focus on name input when create panel opens
  useEffect(() => {
    if (createPanelOpen) {
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }
  }, [createPanelOpen]);

  // Native deactivate dialog lifecycle
  useEffect(() => {
    const dialog = deactivateDialogRef.current;
    if (!dialog) return;
    if (userToDeactivate) {
      setDeactivateError(null);
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [userToDeactivate]);

  // Native role change dialog lifecycle
  useEffect(() => {
    const dialog = roleDialogRef.current;
    if (!dialog) return;
    if (userToChangeRole) {
      setRoleError(null);
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [userToChangeRole]);

  function openCreatePanel() {
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setShowNewPassword(false);
    setNewRole('collaborator');
    setFormError(null);
    setCreatePanelOpen(true);
  }

  function closeCreatePanel() {
    setCreatePanelOpen(false);
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setShowNewPassword(false);
    setNewRole('collaborator');
    setFormError(null);
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isFormSubmittingRef.current) return;
    isFormSubmittingRef.current = true;
    setFormBusy(true);
    setFormError(null);

    const validation = createUserSchema.safeParse({
      name: newName.trim(),
      email: newEmail.trim().toLowerCase(),
      password: newPassword,
      role: newRole,
    });

    if (!validation.success) {
      const firstIssue = validation.error.issues[0];
      const fieldName = firstIssue?.path[0] as string | undefined;
      let errorMessage = firstIssue?.message || 'Verifique os dados informados.';
      if (fieldName === 'name') {
        errorMessage = 'O nome completo é obrigatório (1 a 100 caracteres).';
        nameInputRef.current?.focus();
      } else if (fieldName === 'email') {
        errorMessage = 'Informe um endereço de e-mail válido com até 254 caracteres.';
        emailInputRef.current?.focus();
      } else if (fieldName === 'password') {
        errorMessage = 'Informe uma senha de acesso com até 128 caracteres.';
        passwordInputRef.current?.focus();
      }
      setFormError(errorMessage);
      setNewPassword('');
      setShowNewPassword(false);
      isFormSubmittingRef.current = false;
      setFormBusy(false);
      return;
    }

    const controller = new AbortController();

    try {
      await api.createUser(validation.data, controller.signal, onUnauthorized);
      showToast(`Usuário "${newName.trim()}" cadastrado com sucesso.`);
      closeCreatePanel();
      void loadUsers();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'USER_CONFLICT') {
        setFormError('Já existe um usuário cadastrado com este e-mail.');
      } else if (error instanceof ApiError && error.status === 403) {
        setFormError('Você não tem permissão para cadastrar novos membros.');
      } else {
        setFormError('Não foi possível cadastrar o usuário. Tente novamente.');
      }
    } finally {
      // Always wipe password immediately from memory
      setNewPassword('');
      setShowNewPassword(false);
      isFormSubmittingRef.current = false;
      setFormBusy(false);
    }
  }

  async function handleDeactivateConfirm() {
    if (isActionBusyRef.current || !userToDeactivate) return;
    isActionBusyRef.current = true;
    setActionBusy(true);
    setDeactivateError(null);

    const controller = new AbortController();
    try {
      await api.deactivateUser(userToDeactivate.id, controller.signal, onUnauthorized);
      showToast(`Usuário "${userToDeactivate.name}" desativado com sucesso.`);
      setUserToDeactivate(null);
      void loadUsers();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'LAST_ADMINISTRATOR') {
        setDeactivateError('Operação recusada: não é possível desativar o último administrador do sistema.');
      } else if (error instanceof ApiError && error.status === 403) {
        setDeactivateError('Você não tem permissão para desativar este usuário.');
      } else {
        setDeactivateError('Não foi possível desativar o usuário. Tente novamente.');
      }
    } finally {
      isActionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  async function handleRoleChangeConfirm() {
    if (isActionBusyRef.current || !userToChangeRole) return;
    const { user, targetRole } = userToChangeRole;
    isActionBusyRef.current = true;
    setActionBusy(true);
    setRoleError(null);

    const controller = new AbortController();
    try {
      await api.changeUserRole(user.id, targetRole, controller.signal, onUnauthorized);
      setNoticeMessage(
        `Papel de "${user.name}" alterado para ${targetRole === 'administrator' ? 'Administrador' : 'Colaborador'}.`,
      );
      setUserToChangeRole(null);
      void loadUsers();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'LAST_ADMINISTRATOR') {
        setRoleError('Operação recusada: não é possível rebaixar o último administrador do sistema.');
      } else if (error instanceof ApiError && error.status === 403) {
        setRoleError('Você não tem permissão para alterar papéis de usuários.');
      } else {
        setRoleError('Não foi possível alterar o papel do usuário. Tente novamente.');
      }
    } finally {
      isActionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  return (
    <section className="view-panel" aria-labelledby="team-heading">
      <div className="panel-header">
        <div>
          <h1 id="team-heading">Equipe</h1>
          <p className="panel-subtitle">Gerencie os acessos, papéis e colaboradores da agência.</p>
        </div>
        {hasCreate && (
          <button
            type="button"
            className="primary-button"
            onClick={openCreatePanel}
            disabled={loading || createPanelOpen}
          >
            + Novo membro
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

      {/* Inline Form Panel for Create User */}
      {createPanelOpen && (
        <section className="inline-panel" aria-labelledby="create-user-title">
          <div className="panel-header">
            <h2 id="create-user-title">Cadastrar novo membro</h2>
            <button
              type="button"
              className="close-button"
              onClick={closeCreatePanel}
              aria-label="Fechar formulário"
              disabled={formBusy}
            >
              ✕
            </button>
          </div>

          <form onSubmit={(event) => void handleCreateUser(event)} noValidate>
            {formError && (
              <div className="alert-banner error" role="alert">
                <span>{formError}</span>
              </div>
            )}

            <div className="form-field">
              <label htmlFor="new-user-name">Nome completo *</label>
              <input
                ref={nameInputRef}
                id="new-user-name"
                type="text"
                maxLength={100}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                required
                disabled={formBusy}
              />
            </div>

            <div className="form-field">
              <label htmlFor="new-user-email">E-mail *</label>
              <input
                ref={emailInputRef}
                id="new-user-email"
                type="email"
                maxLength={254}
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
                disabled={formBusy}
              />
            </div>

            <div className="form-field">
              <label htmlFor="new-user-password">Senha de acesso *</label>
              <div className="password-field">
                <input
                  ref={passwordInputRef}
                  id="new-user-password"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  disabled={formBusy}
                />
                <PasswordVisibilityButton visible={showNewPassword} onToggle={() => setShowNewPassword((current) => !current)} disabled={formBusy} />
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="new-user-role">Papel inicial</label>
              <select
                id="new-user-role"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as Role)}
                disabled={formBusy}
              >
                <option value="collaborator">Colaborador (padrão)</option>
                <option value="administrator">Administrador</option>
              </select>
            </div>

            <div className="panel-actions">
              <button type="button" className="secondary-button" onClick={closeCreatePanel} disabled={formBusy}>
                Cancelar
              </button>
              <button type="submit" className="primary-button" disabled={formBusy}>
                {formBusy ? 'Cadastrando…' : 'Cadastrar membro'}
              </button>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <div className="empty-state" aria-live="polite">
          <p className="status-text">Carregando membros da equipe…</p>
        </div>
      ) : listError ? (
        <div className="empty-state error" role="alert">
          <p className="error-text">{listError}</p>
          <button type="button" className="secondary-button" onClick={() => void loadUsers()}>
            Tentar novamente
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Nenhum membro cadastrado.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table" aria-label="Tabela de membros da equipe">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">E-mail</th>
                <th scope="col">Papel</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isAdmin = u.role === 'administrator';
                return (
                  <tr key={u.id} className={!u.active ? 'row-inactive' : ''}>
                    <td>
                      <span className="user-table-name">{u.name}</span>
                      {u.id === session.user.id && <span className="self-tag">(você)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`role-badge ${isAdmin ? 'admin' : 'collab'}`}>
                        {isAdmin ? 'Administrador' : 'Colaborador'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${u.active ? 'active' : 'archived'}`}>
                        {u.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="action-buttons">
                        {hasManageRoles && u.active && (
                          <button
                            type="button"
                            className="action-btn role-change"
                            onClick={() => {
                              const targetRole: Role = isAdmin ? 'collaborator' : 'administrator';
                              setRoleError(null);
                              setUserToChangeRole({ user: u, targetRole });
                            }}
                            disabled={actionBusy}
                            title={isAdmin ? 'Tornar colaborador' : 'Tornar administrador'}
                          >
                            {isAdmin ? 'Tornar colaborador' : 'Tornar admin'}
                          </button>
                        )}
                        {hasDeactivate && u.active && (
                          <button
                            type="button"
                            className="action-btn danger"
                            onClick={() => {
                              setDeactivateError(null);
                              setUserToDeactivate(u);
                            }}
                            disabled={actionBusy}
                          >
                            Desativar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Native Dialog for Deactivate User Confirmation */}
      <dialog
        ref={deactivateDialogRef}
        className="native-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!isActionBusyRef.current) {
              setUserToDeactivate(null);
              setDeactivateError(null);
            }
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!actionBusy) {
            setUserToDeactivate(null);
            setDeactivateError(null);
          }
        }}
      >
        <div className="dialog-header">
          <h2>Confirmar desativação</h2>
          <button
            type="button"
            className="close-button"
            onClick={() => {
              setUserToDeactivate(null);
              setDeactivateError(null);
            }}
            aria-label="Cancelar desativação"
            disabled={actionBusy}
          >
            ✕
          </button>
        </div>
        <div className="dialog-body">
          {deactivateError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: 12 }}>
              <span>{deactivateError}</span>
            </div>
          )}
          <p>
            Deseja realmente desativar a conta de <strong>&ldquo;{userToDeactivate?.name}&rdquo;</strong>?
          </p>
          <p className="muted-text">
            Todas as sessões ativas do usuário serão imediatamente revogadas e ele não poderá mais acessar o sistema.
          </p>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setUserToDeactivate(null);
              setDeactivateError(null);
            }}
            disabled={actionBusy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void handleDeactivateConfirm()}
            disabled={actionBusy}
          >
            {actionBusy ? 'Desativando…' : 'Sim, desativar usuário'}
          </button>
        </div>
      </dialog>

      {/* Native Dialog for Role Change Confirmation */}
      <dialog
        ref={roleDialogRef}
        className="native-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!isActionBusyRef.current) {
              setUserToChangeRole(null);
              setRoleError(null);
            }
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (!actionBusy) {
            setUserToChangeRole(null);
            setRoleError(null);
          }
        }}
      >
        <div className="dialog-header">
          <h2>Confirmar alteração de papel</h2>
          <button
            type="button"
            className="close-button"
            onClick={() => {
              setUserToChangeRole(null);
              setRoleError(null);
            }}
            aria-label="Cancelar alteração"
            disabled={actionBusy}
          >
            ✕
          </button>
        </div>
        <div className="dialog-body">
          {roleError && (
            <div className="alert-banner error" role="alert" style={{ marginBottom: 12 }}>
              <span>{roleError}</span>
            </div>
          )}
          {userToChangeRole && (
            <>
              <p>
                Deseja alterar o papel de <strong>&ldquo;{userToChangeRole.user.name}&rdquo;</strong> para{' '}
                <strong>
                  {userToChangeRole.targetRole === 'administrator' ? 'Administrador' : 'Colaborador'}
                </strong>
                ?
              </p>
              <p className="muted-text">
                {userToChangeRole.targetRole === 'administrator'
                  ? 'O usuário terá acesso completo às funções administrativas da agência.'
                  : 'O usuário perderá os privilégios administrativos e seus acessos serão restritos.'}
              </p>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setUserToChangeRole(null);
              setRoleError(null);
            }}
            disabled={actionBusy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleRoleChangeConfirm()}
            disabled={actionBusy}
          >
            {actionBusy ? 'Alterando…' : 'Confirmar alteração'}
          </button>
        </div>
      </dialog>
    </section>
  );
}
