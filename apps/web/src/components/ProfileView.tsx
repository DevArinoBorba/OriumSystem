import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  changePasswordSchema,
  updateProfileSchema,
  type Permission,
  type SessionResponse,
} from '@orium/contracts';
import { api, ApiError } from '../api.js';
import { PasswordVisibilityButton } from './PasswordVisibilityButton.js';

interface ProfileViewProps {
  session: SessionResponse;
  onUnauthorized: () => void;
  onSessionUpdate?: (session: SessionResponse) => void;
}

const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

async function processAvatarFileToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Falha ao ler o arquivo de imagem.'));
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('O arquivo selecionado não é uma imagem válida.'));
    element.src = rawDataUrl;
  });

  const targetSizes = [160, 128, 96];
  const qualities = [0.84, 0.74, 0.64];

  for (const size of targetSizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;

    // Square center-crop so avatar never stretches
    const minSide = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = ((img.naturalWidth || img.width) - minSide) / 2;
    const sy = ((img.naturalHeight || img.height) - minSide) / 2;
    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

    for (const quality of qualities) {
      const compressed = canvas.toDataURL('image/jpeg', quality);
      if (compressed.length <= 12000) {
        return compressed;
      }
    }
  }

  return rawDataUrl;
}

const PERMISSION_META: Record<Permission, { label: string; category: string }> = {
  'protected.read': { label: 'Acesso à Área Protegida', category: 'Identidade' },
  'users.read': { label: 'Visualizar Equipe', category: 'Equipe & Acessos' },
  'users.create': { label: 'Cadastrar Membros', category: 'Equipe & Acessos' },
  'users.deactivate': { label: 'Desativar Contas', category: 'Equipe & Acessos' },
  'roles.manage': { label: 'Gerenciar Papéis e Permissões', category: 'Equipe & Acessos' },
  'clients.read': { label: 'Visualizar Todos os Clientes', category: 'Clientes' },
  'clients.read.assigned': { label: 'Visualizar Clientes Alocados', category: 'Clientes' },
  'clients.write': { label: 'Criar e Editar Clientes', category: 'Clientes' },
  'clients.manage': { label: 'Gerenciar Escopo Contratado', category: 'Clientes' },
  'clients.team.manage': { label: 'Gerenciar Equipe do Cliente', category: 'Clientes' },
  'clients.archive': { label: 'Arquivar e Restaurar Clientes', category: 'Clientes' },
  'demands.read': { label: 'Visualizar Demandas', category: 'Operação' },
  'demands.write': { label: 'Criar e Editar Demandas', category: 'Operação' },
  'tasks.read': { label: 'Visualizar Tarefas', category: 'Operação' },
  'tasks.manage': { label: 'Gerenciar e Atribuir Tarefas', category: 'Operação' },
  'tasks.execute': { label: 'Executar e Entregar Tarefas', category: 'Operação' },
  'tasks.review': { label: 'Revisar e Aprovar Entregas', category: 'Operação' },
  'materials.read': { label: 'Visualizar Materiais e Links', category: 'Materiais' },
  'materials.write': { label: 'Publicar e Editar Materiais', category: 'Materiais' },
  'materials.archive': { label: 'Arquivar e Restaurar Materiais', category: 'Materiais' },
};

function getInitials(name: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return 'U';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1];
  const firstChar = first[0] ?? '';
  const lastChar = last?.[0] ?? '';
  return (firstChar + lastChar).toUpperCase() || 'U';
}

export function ProfileView({ session, onUnauthorized, onSessionUpdate }: ProfileViewProps) {
  const isAdmin = session.roles.includes('administrator');

  // Personal Data Form State
  const [displayUser, setDisplayUser] = useState(session.user);
  const [name, setName] = useState(session.user.name);
  const [imageUrl, setImageUrl] = useState(session.user.image ?? '');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const isProfileSubmittingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password Change Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const isPasswordSubmittingRef = useRef(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayUser(session.user);
    setName(session.user.name);
    setImageUrl(session.user.image ?? '');
    setUploadedFileName(null);
    setImageLoadError(false);
  }, [session.user]);

  const trimmedName = name.trim();
  const trimmedImage = imageUrl.trim();
  const currentImage = displayUser.image ?? '';
  const isDataUrlImage = trimmedImage.startsWith('data:image/');
  const hasProfileChanges = trimmedName !== displayUser.name || trimmedImage !== currentImage;

  async function handlePhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setProfileError(null);
    setProfileSuccess(null);

    if (!file.type.startsWith('image/')) {
      setProfileError('Selecione um arquivo de imagem válido (JPG, PNG, WEBP ou GIF).');
      return;
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setProfileError('A imagem selecionada excede o limite de 5 MB. Escolha um arquivo menor.');
      return;
    }

    try {
      const processedDataUrl = await processAvatarFileToDataUrl(file);
      setImageUrl(processedDataUrl);
      setUploadedFileName(file.name);
      setImageLoadError(false);
    } catch {
      setProfileError('Não foi possível processar a foto selecionada. Tente outra imagem.');
    }
  }

  function handleRemovePhoto() {
    setImageUrl('');
    setUploadedFileName(null);
    setImageLoadError(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleUpdateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isProfileSubmittingRef.current) return;

    setProfileSuccess(null);
    setProfileError(null);

    const parsed = updateProfileSchema.safeParse({
      name: trimmedName,
      image: trimmedImage ? trimmedImage : null,
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue?.path[0];
      if (field === 'name') {
        setProfileError('O nome completo deve conter entre 2 e 100 caracteres.');
        nameInputRef.current?.focus();
      } else if (field === 'image') {
        setProfileError('Envie um arquivo de imagem válido ou informe uma URL válida (https://...).');
      } else {
        setProfileError('Verifique os dados informados e tente novamente.');
      }
      return;
    }

    isProfileSubmittingRef.current = true;
    setProfileBusy(true);
    const controller = new AbortController();

    try {
      const updatedSession = await api.updateProfile(parsed.data, controller.signal, onUnauthorized);
      const nextUser = {
        ...updatedSession.user,
        name: parsed.data.name,
        ...(parsed.data.image ? { image: parsed.data.image } : {}),
      };
      const mergedSession: SessionResponse = {
        ...updatedSession,
        user: nextUser,
      };
      // Keep parent session in sync even if onSessionUpdate wasn't passed
      session.user.name = nextUser.name;
      session.user.image = nextUser.image;
      setDisplayUser(nextUser);
      setName(nextUser.name);
      setImageUrl(nextUser.image ?? '');
      setImageLoadError(false);
      onSessionUpdate?.(mergedSession);
      window.dispatchEvent(new CustomEvent('orium:session-updated', { detail: mergedSession }));
      setProfileSuccess('Dados atualizados com sucesso');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof ApiError && error.code === 'INVALID_INPUT') {
        setProfileError('Dados inválidos. Verifique seu nome e a foto selecionada.');
      } else {
        setProfileError('Não foi possível atualizar seus dados no momento. Tente novamente.');
      }
    } finally {
      isProfileSubmittingRef.current = false;
      setProfileBusy(false);
    }
  }

  function handleResetProfile() {
    setName(displayUser.name);
    setImageUrl(displayUser.image ?? '');
    setUploadedFileName(null);
    setImageLoadError(false);
    setProfileError(null);
    setProfileSuccess(null);
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPasswordSubmittingRef.current) return;

    setPasswordSuccess(null);
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Informe sua senha atual para continuar.');
      currentPasswordRef.current?.focus();
      return;
    }

    if (!newPassword || newPassword.length < 1 || newPassword.length > 128) {
      setPasswordError('A nova senha deve ter entre 1 e 128 caracteres.');
      newPasswordRef.current?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem. Verifique a confirmação da nova senha.');
      confirmPasswordRef.current?.focus();
      return;
    }

    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
    });

    if (!parsed.success) {
      setPasswordError('Verifique os campos de senha (1 a 128 caracteres) e tente novamente.');
      return;
    }

    isPasswordSubmittingRef.current = true;
    setPasswordBusy(true);
    const controller = new AbortController();

    try {
      const result = await api.changePassword(parsed.data, controller.signal, onUnauthorized);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      if (result.revokedCount && result.revokedCount > 0) {
        setPasswordSuccess(
          `Senha alterada com sucesso (${result.revokedCount} ${result.revokedCount === 1 ? 'outra sessão ativa encerrada' : 'outras sessões ativas encerradas'}).`,
        );
      } else {
        setPasswordSuccess('Senha alterada com sucesso');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (
        error instanceof ApiError &&
        (error.code === 'INVALID_CREDENTIALS' || error.status === 401 || error.status === 400)
      ) {
        setPasswordError('Senha atual incorreta. Verifique e tente novamente.');
        currentPasswordRef.current?.focus();
      } else {
        setPasswordError('Não foi possível alterar a senha no momento. Tente novamente.');
      }
    } finally {
      isPasswordSubmittingRef.current = false;
      setPasswordBusy(false);
    }
  }

  const avatarPreviewUrl = trimmedImage && !imageLoadError ? trimmedImage : null;

  return (
    <section className="view-panel profile-view-panel" aria-labelledby="profile-heading">
      {/* 1. Cabeçalho da Página */}
      <div className="panel-header profile-page-header">
        <div>
          <div className="profile-title-row">
            <h1 id="profile-heading">Meu Perfil</h1>
            <span className={`role-badge profile-role-pill ${isAdmin ? 'admin' : 'collab'}`}>
              {isAdmin ? 'Administrador' : 'Colaborador'}
            </span>
          </div>
          <p className="panel-subtitle">
            Gerencie seus dados pessoais, credenciais de acesso e permissões operacionais no OriumSystem.
          </p>
        </div>
        <div className="profile-header-status">
          <span className="status-badge active">Conta Ativa</span>
        </div>
      </div>

      <div className="profile-layout-grid">
        {/* 2. Card de Dados Pessoais & Permissões */}
        <article className="profile-card" aria-labelledby="personal-data-heading">
          <div className="profile-card-header">
            <div>
              <h2 id="personal-data-heading" className="profile-card-title">
                Dados Pessoais
              </h2>
              <p className="profile-card-subtitle">
                Suas informações de identificação exibidas para a equipe e nos históricos operacionais.
              </p>
            </div>
          </div>

          {/* Avatar 64px + Resumo de Identidade */}
          <div className="profile-identity-banner">
            <div className="profile-avatar-xl" aria-hidden="true">
              {avatarPreviewUrl ? (
                <img
                  src={avatarPreviewUrl}
                  alt=""
                  className="profile-avatar-xl-img"
                  onError={() => setImageLoadError(true)}
                />
              ) : (
                <span>{getInitials(trimmedName || displayUser.name)}</span>
              )}
            </div>
            <div className="profile-identity-details">
              <div className="profile-identity-name-row">
                <strong className="profile-identity-name">{displayUser.name}</strong>
                <span className={`role-badge ${isAdmin ? 'admin' : 'collab'}`}>
                  {isAdmin ? 'Administrador' : 'Colaborador'}
                </span>
              </div>
              <span className="profile-identity-email">{displayUser.email}</span>
              <span className="profile-identity-id">ID: {displayUser.id}</span>
            </div>
          </div>

          {profileSuccess && (
            <div className="alert-banner success" role="status">
              <div className="profile-alert-content">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>{profileSuccess}</span>
              </div>
              <button
                type="button"
                className="close-alert"
                onClick={() => setProfileSuccess(null)}
                aria-label="Fechar confirmação de atualização de perfil"
              >
                ✕
              </button>
            </div>
          )}

          {profileError && (
            <div className="alert-banner error" role="alert">
              <div className="profile-alert-content">
                <span>{profileError}</span>
              </div>
              <button
                type="button"
                className="close-alert"
                onClick={() => setProfileError(null)}
                aria-label="Fechar erro de atualização de perfil"
              >
                ✕
              </button>
            </div>
          )}

          <form onSubmit={(event) => void handleUpdateProfile(event)} noValidate className="profile-form">
            <div className="form-field">
              <label htmlFor="profile-name">Nome Completo *</label>
              <input
                ref={nameInputRef}
                id="profile-name"
                name="name"
                type="text"
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Seu nome completo"
                required
                disabled={profileBusy}
              />
              <span className="profile-field-hint">
                Entre 2 e 100 caracteres. Este nome aparecerá em demandas, tarefas e comentários.
              </span>
            </div>

            <div className="form-field">
              <label htmlFor="profile-photo-file">Foto (opcional)</label>
              <input
                ref={fileInputRef}
                id="profile-photo-file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => void handlePhotoFileChange(event)}
                className="sr-only-file-input"
                disabled={profileBusy}
              />
              <div className="profile-photo-upload-box">
                <div className="profile-photo-upload-actions">
                  <button
                    type="button"
                    className="secondary-button profile-upload-trigger-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={profileBusy}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>{trimmedImage ? 'Trocar arquivo' : 'Enviar arquivo'}</span>
                  </button>

                  {trimmedImage && (
                    <button
                      type="button"
                      className="ghost-button profile-remove-photo-btn"
                      onClick={handleRemovePhoto}
                      disabled={profileBusy}
                    >
                      Remover foto
                    </button>
                  )}

                  {isDataUrlImage && (
                    <span className="profile-uploaded-file-pill" title={uploadedFileName ?? 'Imagem carregada do computador'}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{uploadedFileName ?? 'Arquivo de imagem carregado'}</span>
                    </span>
                  )}
                </div>

                {!isDataUrlImage && (
                  <input
                    id="profile-image"
                    name="image"
                    type="url"
                    value={imageUrl}
                    onChange={(event) => {
                      setImageUrl(event.target.value);
                      setUploadedFileName(null);
                      setImageLoadError(false);
                    }}
                    placeholder="Ou cole uma URL de imagem (https://exemplo.com/sua-foto.jpg)"
                    disabled={profileBusy}
                  />
                )}
              </div>
              <span className="profile-field-hint">
                Envie uma imagem do seu dispositivo (JPG, PNG, WEBP ou GIF até 5 MB) ou informe uma URL externa.
              </span>
            </div>

            <div className="form-field">
              <div className="profile-label-with-badge">
                <label htmlFor="profile-email">E-mail de Identidade</label>
                <span className="verified-email-badge" title="Chave de identidade verificada">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Verificado
                </span>
              </div>
              <input
                id="profile-email"
                type="email"
                value={displayUser.email}
                readOnly
                disabled
                className="profile-readonly-input"
                aria-readonly="true"
              />
              <span className="profile-field-hint">
                O e-mail é a chave única de identidade da sua conta e não pode ser alterado.
              </span>
            </div>

            <div className="profile-form-actions">
              {hasProfileChanges && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleResetProfile}
                  disabled={profileBusy}
                >
                  Restaurar
                </button>
              )}
              <button
                type="submit"
                className="primary-button"
                disabled={profileBusy || !trimmedName}
              >
                {profileBusy ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </form>

          <div className="profile-section-divider" />

          {/* Papel & Permissões */}
          <div className="profile-permissions-section" aria-labelledby="permissions-heading">
            <div className="profile-permissions-header">
              <div>
                <h3 id="permissions-heading" className="profile-section-subtitle">
                  Papel &amp; Permissões Atribuídas
                </h3>
                <p className="profile-field-hint">
                  {isAdmin
                    ? 'Como Administrador, você possui controle integral sobre clientes, equipe, templates, demandas e relatórios.'
                    : 'Como Colaborador, suas permissões seguem o escopo operacional de execução e acompanhamento.'}
                </p>
              </div>
              <span className="profile-permissions-count">
                {session.permissions.length} {session.permissions.length === 1 ? 'permissão ativa' : 'permissões ativas'}
              </span>
            </div>

            <div className="permissions-chip-grid" role="list" aria-label="Permissões concedidas ao seu perfil">
              {session.permissions.map((perm) => {
                const meta = PERMISSION_META[perm] ?? { label: perm, category: 'Sistema' };
                return (
                  <div key={perm} className="permission-chip-card" role="listitem">
                    <div className="permission-chip-top">
                      <span className="permission-chip-category">{meta.category}</span>
                      <span className="permission-chip-dot" aria-hidden="true" />
                    </div>
                    <strong className="permission-chip-label">{meta.label}</strong>
                    <code className="permission-chip-code">{perm}</code>
                  </div>
                );
              })}
            </div>
          </div>
        </article>

        {/* 3. Card de Segurança & Senha */}
        <article className="profile-card" aria-labelledby="security-heading">
          <div className="profile-card-header">
            <div>
              <h2 id="security-heading" className="profile-card-title">
                Segurança &amp; Senha
              </h2>
              <p className="profile-card-subtitle">
                Atualize sua credencial de acesso. Por segurança, a alteração exige confirmação da senha atual.
              </p>
            </div>
          </div>

          <div className="security-policy-box">
            <div className="security-policy-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div className="security-policy-text">
              <strong>Política de Credenciais (ADR-0007)</strong>
              <p>
                Sua nova senha deve conter de <strong>1 a 128 caracteres</strong>. Ao alterar a senha, demais sessões ativas em outros dispositivos são revogadas automaticamente e o evento é registrado na auditoria de identidade.
              </p>
            </div>
          </div>

          {passwordSuccess && (
            <div className="alert-banner success" role="status">
              <div className="profile-alert-content">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>{passwordSuccess}</span>
              </div>
              <button
                type="button"
                className="close-alert"
                onClick={() => setPasswordSuccess(null)}
                aria-label="Fechar confirmação de alteração de senha"
              >
                ✕
              </button>
            </div>
          )}

          {passwordError && (
            <div className="alert-banner error" role="alert">
              <div className="profile-alert-content">
                <span>{passwordError}</span>
              </div>
              <button
                type="button"
                className="close-alert"
                onClick={() => setPasswordError(null)}
                aria-label="Fechar aviso de erro de senha"
              >
                ✕
              </button>
            </div>
          )}

          <form onSubmit={(event) => void handleChangePassword(event)} noValidate className="profile-form">
            <div className="form-field">
              <label htmlFor="current-password">Senha Atual *</label>
              <div className="password-field">
                <input
                  ref={currentPasswordRef}
                  id="current-password"
                  name="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  maxLength={128}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Digite sua senha atual"
                  required
                  disabled={passwordBusy}
                />
                <PasswordVisibilityButton
                  visible={showCurrentPassword}
                  onToggle={() => setShowCurrentPassword((prev) => !prev)}
                  disabled={passwordBusy}
                />
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="new-password">Nova Senha *</label>
              <div className="password-field">
                <input
                  ref={newPasswordRef}
                  id="new-password"
                  name="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={1}
                  maxLength={128}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Digite a nova senha (1 a 128 caracteres)"
                  required
                  disabled={passwordBusy}
                />
                <PasswordVisibilityButton
                  visible={showNewPassword}
                  onToggle={() => setShowNewPassword((prev) => !prev)}
                  disabled={passwordBusy}
                />
              </div>
              <span className="profile-field-hint">
                Deve conter entre 1 e 128 caracteres (ADR-0007).
              </span>
            </div>

            <div className="form-field">
              <label htmlFor="confirm-password">Confirmação da Nova Senha *</label>
              <div className="password-field">
                <input
                  ref={confirmPasswordRef}
                  id="confirm-password"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={1}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repita a nova senha para confirmar"
                  required
                  disabled={passwordBusy}
                />
                <PasswordVisibilityButton
                  visible={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword((prev) => !prev)}
                  disabled={passwordBusy}
                />
              </div>
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <span className="profile-field-mismatch" role="status">
                  As senhas digitadas não coincidem.
                </span>
              )}
            </div>

            <div className="profile-form-actions">
              {(currentPassword || newPassword || confirmPassword) && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setShowCurrentPassword(false);
                    setShowNewPassword(false);
                    setShowConfirmPassword(false);
                    setPasswordError(null);
                  }}
                  disabled={passwordBusy}
                >
                  Limpar
                </button>
              )}
              <button
                type="submit"
                className="primary-button"
                disabled={passwordBusy}
              >
                {passwordBusy ? 'Atualizando senha…' : 'Alterar senha'}
              </button>
            </div>
          </form>
        </article>
      </div>
    </section>
  );
}
