import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type {
  Client,
  ClientCredential,
  ClientCredentialCategory,
  HermesStatusResponse,
} from '../types';

type Props = {
  onUnauthorized: () => void;
};

const CATEGORY_LABELS: Record<ClientCredentialCategory, string> = {
  hosting: 'Hospedagem / Servidor (HostGator, cPanel, VPS)',
  domain: 'Domínio / DNS (Registro.br, Cloudflare)',
  cms: 'CMS / Site (WordPress, Shopify, Webflow)',
  ads: 'Tráfego Pago (Meta Ads, Google Ads, TikTok Ads)',
  social: 'Redes Sociais (Instagram, LinkedIn, YouTube)',
  analytics: 'Analytics / Tag Manager / Search Console',
  email: 'E-mail / Workspace / Zoho',
  database: 'Banco de Dados / API / Sistema',
  other: 'Outro Acesso',
};

const CATEGORY_BADGES: Record<ClientCredentialCategory, string> = {
  hosting: 'Hospedagem',
  domain: 'Domínio / DNS',
  cms: 'CMS / WordPress',
  ads: 'Ads / Tráfego',
  social: 'Social Media',
  analytics: 'Analytics',
  email: 'E-mail',
  database: 'Banco / API',
  other: 'Outro',
};

export function VaultView({ onUnauthorized }: Props) {
  const [hermes, setHermes] = useState<HermesStatusResponse | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [credentials, setCredentials] = useState<ClientCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Revealed secrets map: credentialId -> plaintext secret
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New Credential Modal / Form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formClientId, setFormClientId] = useState('');
  const [formCategory, setFormCategory] = useState<ClientCredentialCategory>('hosting');
  const [formLabel, setFormLabel] = useState('');
  const [formServiceUrl, setFormServiceUrl] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [showFormSecret, setShowFormSecret] = useState(false);

  const loadData = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const [hermesRes, clientsRes, credsRes] = await Promise.all([
          api.getHermesStatus(signal, onUnauthorized),
          api.listClients({ status: 'active', pageSize: 100 }, signal, onUnauthorized),
          api.listClientCredentials(
            {
              clientId: filterClientId || undefined,
              search: searchQuery.trim() || undefined,
            },
            signal,
            onUnauthorized,
          ),
        ]);
        if (!signal.aborted) {
          setHermes(hermesRes);
          setClients(clientsRes.clients);
          setCredentials(credsRes.credentials);
          if (!formClientId && clientsRes.clients[0]) {
            setFormClientId(clientsRes.clients[0].id);
          }
        }
      } catch (err) {
        if (!signal.aborted) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar o Cofre e status do Hermes.');
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    },
    [filterClientId, searchQuery, onUnauthorized, formClientId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const handleToggleReveal = async (credentialId: string) => {
    if (revealedSecrets[credentialId] !== undefined) {
      setRevealedSecrets((prev) => {
        const next = { ...prev };
        delete next[credentialId];
        return next;
      });
      return;
    }

    setRevealingId(credentialId);
    const controller = new AbortController();
    try {
      const res = await api.revealClientCredentialSecret(credentialId, controller.signal, onUnauthorized);
      setRevealedSecrets((prev) => ({ ...prev, [credentialId]: res.secret }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível descriptografar a credencial.');
    } finally {
      setRevealingId(null);
    }
  };

  const handleCopySecret = async (credentialId: string) => {
    const controller = new AbortController();
    try {
      let secret = revealedSecrets[credentialId];
      if (!secret) {
        setRevealingId(credentialId);
        const res = await api.revealClientCredentialSecret(credentialId, controller.signal, onUnauthorized);
        const resolvedSecret = res.secret;
        secret = resolvedSecret;
        setRevealedSecrets((prev) => ({ ...prev, [credentialId]: resolvedSecret }));
      }
      await navigator.clipboard.writeText(secret);
      setCopiedKey(`secret-${credentialId}`);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setError('Não foi possível copiar a senha.');
    } finally {
      setRevealingId(null);
    }
  };

  const handleCopyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId || !formLabel.trim() || !formUsername.trim() || !formSecret) {
      setError('Preencha o cliente, serviço, login e senha.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    const controller = new AbortController();
    try {
      await api.createClientCredential(
        {
          clientId: formClientId,
          category: formCategory,
          label: formLabel.trim(),
          serviceUrl: formServiceUrl.trim() || null,
          username: formUsername.trim(),
          secret: formSecret,
          notes: formNotes.trim() || null,
        },
        controller.signal,
        onUnauthorized,
      );
      setFormLabel('');
      setFormServiceUrl('');
      setFormUsername('');
      setFormSecret('');
      setFormNotes('');
      setShowCreateForm(false);
      setFeedback('Credencial criptografada (AES-256-GCM) e salva no cofre com sucesso. O Hermes já pode consultá-la no WhatsApp!');
      await loadData(controller.signal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar credencial no cofre.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (cred: ClientCredential) => {
    if (!window.confirm(`Remover a credencial "${cred.label}" do cliente "${cred.clientName}"?`)) {
      return;
    }
    const controller = new AbortController();
    try {
      await api.deleteClientCredential(cred.id, controller.signal, onUnauthorized);
      setFeedback(`Credencial "${cred.label}" removida com sucesso.`);
      await loadData(controller.signal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir credencial.');
    }
  };

  return (
    <div className="reports-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h1 className="section-title" style={{ margin: 0 }}>
              Cofre de Senhas &amp; Secretário Hermes IA
            </h1>
            <span className="badge badge--success">AES-256-GCM + WhatsApp</span>
          </div>
          <p className="section-subtitle" style={{ marginTop: '0.35rem' }}>
            Guarde senhas de clientes (HostGator, WordPress, cPanel, Meta Ads, Registro.br) com criptografia militar. Quando um Administrador perguntar no WhatsApp, o Hermes consulta o banco e responde na hora.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <a
            href={hermes?.omnirouteUrl || 'https://omniroute.187.77.251.41.sslip.io/'}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <span>⚡ Abrir Painel OmniRoute (Provedores IA)</span>
          </a>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShowCreateForm((prev) => !prev)}
          >
            {showCreateForm ? 'Fechar Formulário' : '+ Nova Credencial de Cliente'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setError(null)}>
            Fechar
          </button>
        </div>
      )}

      {feedback && (
        <div
          className="alert"
          role="status"
          style={{
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            color: 'var(--text-primary)',
            padding: '0.85rem 1rem',
            borderRadius: '0.75rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>✅ {feedback}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFeedback(null)}>
            OK
          </button>
        </div>
      )}

      {/* Card de Status do Hermes Agent + OmniRoute */}
      <div
        className="card"
        style={{
          padding: '1.25rem 1.5rem',
          border: '1px solid var(--border-subtle)',
          borderRadius: '1rem',
          background: 'var(--surface-elevated)',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Agente na VPS (orium-vps)
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              {hermes?.version || 'Hermes Agent v2026.4'}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Skill ativa: <code>orium-secretary</code>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Gateway de IA (OmniRoute)
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: hermes?.omnirouteHealthy !== false ? '#10b981' : '#f59e0b',
                  display: 'inline-block',
                }}
              />
              {hermes?.omnirouteHealthy !== false ? 'Online (HTTPS)' : 'Aguardando Provedor'}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              URL: <code>https://omniroute.187.77.251.41.sslip.io/</code>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Credenciais no Cofre
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.2rem' }}>
              {hermes ? hermes.totalCredentials : credentials.length}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Criptografia <code>AES-256-GCM</code> (HKDF-SHA256)
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Exemplos no WhatsApp
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '0.25rem', lineHeight: 1.45 }}>
              • <em>&ldquo;Qual a senha da HostGator do cliente X?&rdquo;</em>
              <br />• <em>&ldquo;Quais demandas estão atrasadas hoje?&rdquo;</em>
            </div>
          </div>
        </div>
      </div>

      {/* Formulário de Nova Credencial */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="card"
          style={{
            padding: '1.5rem',
            borderRadius: '1rem',
            border: '1px solid var(--accent-primary, #6366f1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Cadastrar Nova Credencial no Cofre</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Cliente *</label>
              <select
                className="form-select"
                value={formClientId}
                onChange={(e) => setFormClientId(e.target.value)}
                required
              >
                <option value="">Selecione um cliente...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Categoria *</label>
              <select
                className="form-select"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value as ClientCredentialCategory)}
              >
                {(Object.keys(CATEGORY_LABELS) as ClientCredentialCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Serviço / Identificação * (ex: HostGator, WordPress)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: HostGator cPanel, WordPress Admin, Registro.br"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">URL de Acesso (opcional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: https://financeiro.hostgator.com.br"
                value={formServiceUrl}
                onChange={(e) => setFormServiceUrl(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Usuário / E-mail / Login *</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: contato@cliente.com.br"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Senha / Chave Secreta *</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type={showFormSecret ? 'text' : 'password'}
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Digite a senha do serviço..."
                  value={formSecret}
                  onChange={(e) => setFormSecret(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setShowFormSecret((prev) => !prev)}
                >
                  {showFormSecret ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Observações / 2FA / Dados Extras (opcional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="Ex: Conta principal da hospedagem; código de cliente #44910"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setShowCreateForm(false)}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Criptografando e Salvando...' : 'Salvar no Cofre (AES-256-GCM)'}
            </button>
          </div>
        </form>
      )}

      {/* Filtros de Busca */}
      <div
        className="card"
        style={{
          padding: '1rem 1.25rem',
          borderRadius: '0.85rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
        }}
      >
        <div style={{ flex: '1 1 260px' }}>
          <input
            type="search"
            className="form-input"
            placeholder="Buscar por cliente, HostGator, WordPress, login ou URL..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ flex: '0 1 260px' }}>
          <select
            className="form-select"
            value={filterClientId}
            onChange={(e) => setFilterClientId(e.target.value)}
          >
            <option value="">Todos os clientes ({clients.length})</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lista de Credenciais */}
      {loading ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Carregando cofre criptografado...
        </div>
      ) : credentials.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Nenhuma credencial cadastrada neste filtro</h3>
          <p style={{ color: 'var(--text-secondary)', margin: '0 0 1.25rem 0' }}>
            Clique em <strong>+ Nova Credencial de Cliente</strong> para guardar acessos de HostGator, WordPress, domínios ou redes sociais. Assim que salvar, o Hermes já consegue responder no WhatsApp!
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setShowCreateForm(true)}>
            + Cadastrar Primeira Credencial
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {credentials.map((cred) => {
            const revealed = revealedSecrets[cred.id];
            const isRevealing = revealingId === cred.id;
            return (
              <div
                key={cred.id}
                className="card"
                style={{
                  padding: '1.25rem',
                  borderRadius: '0.9rem',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div>
                    <span className="badge badge--neutral" style={{ marginBottom: '0.35rem', display: 'inline-block' }}>
                      {CATEGORY_BADGES[cred.category] || cred.category}
                    </span>
                    <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{cred.label}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Cliente: {cred.clientName}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ color: 'var(--danger, #ef4444)' }}
                    onClick={() => handleDelete(cred)}
                    title="Remover credencial"
                  >
                    Excluir
                  </button>
                </div>

                {cred.serviceUrl && (
                  <div style={{ fontSize: '0.82rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>URL: </span>
                    <a
                      href={cred.serviceUrl.startsWith('http') ? cred.serviceUrl : `https://${cred.serviceUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent-primary, #6366f1)', wordBreak: 'break-all' }}
                    >
                      {cred.serviceUrl}
                    </a>
                  </div>
                )}

                <div
                  style={{
                    background: 'var(--surface-base, rgba(0,0,0,0.15))',
                    padding: '0.75rem',
                    borderRadius: '0.6rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Login: </span>
                      <code style={{ fontWeight: 600 }}>{cred.username}</code>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => handleCopyText(cred.username, `user-${cred.id}`)}
                    >
                      {copiedKey === `user-${cred.id}` ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Senha: </span>
                      <code style={{ fontWeight: 700, color: revealed ? '#10b981' : 'inherit' }}>
                        {revealed ?? cred.secretPreview}
                      </code>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => handleToggleReveal(cred.id)}
                        disabled={isRevealing}
                      >
                        {isRevealing ? '...' : revealed ? 'Ocultar' : 'Revelar'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => handleCopySecret(cred.id)}
                        disabled={isRevealing}
                      >
                        {copiedKey === `secret-${cred.id}` ? 'Copiada!' : 'Copiar Senha'}
                      </button>
                    </div>
                  </div>
                </div>

                {cred.notes && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <strong>Obs:</strong> {cred.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
