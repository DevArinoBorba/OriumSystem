import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Client, Demand, SessionResponse } from '@orium/contracts';
import { api } from '../api.js';
import type { ActiveTab } from '../types.js';

/** Busca global (Ctrl+K): telas, chamados e clientes a partir de qualquer lugar. */
export type PaletteTarget =
  | { kind: 'tab'; tab: ActiveTab }
  | { kind: 'demand'; demandId: string }
  | { kind: 'client'; name: string };

type PaletteItem = {
  key: string;
  group: string;
  label: string;
  detail?: string;
  target: PaletteTarget;
};

export type PaletteTab = { tab: ActiveTab; label: string };

interface CommandPaletteProps {
  session: SessionResponse;
  tabs: PaletteTab[];
  onSelect: (target: PaletteTarget) => void;
  onClose: () => void;
  onUnauthorized: () => void;
}

const SEARCH_DELAY_MS = 250;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function CommandPalette({ session, tabs, onSelect, onClose, onUnauthorized }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [demands, setDemands] = useState<Demand[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const canSearchDemands = session.permissions.includes('demands.read');
  const canSearchClients = session.permissions.includes('clients.read');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setDemands([]);
      setClients([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      const q = term.slice(0, 100);
      void Promise.all([
        canSearchDemands
          ? api.listDemands({ q, status: 'all', page: 1, pageSize: 6 }, controller.signal, onUnauthorized)
              .then((res) => res.demands)
              .catch(() => [] as Demand[])
          : Promise.resolve([] as Demand[]),
        canSearchClients
          ? api.listClients({ q, status: 'active', page: 1, pageSize: 5 }, controller.signal, onUnauthorized)
              .then((res) => res.clients)
              .catch(() => [] as Client[])
          : Promise.resolve([] as Client[]),
      ]).then(([foundDemands, foundClients]) => {
        if (controller.signal.aborted) return;
        setDemands(foundDemands);
        setClients(foundClients);
        setSearching(false);
      });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, canSearchDemands, canSearchClients, onUnauthorized]);

  const items = useMemo<PaletteItem[]>(() => {
    const term = normalize(query.trim());
    const tabItems: PaletteItem[] = tabs
      .filter((t) => !term || normalize(t.label).includes(term))
      .map((t) => ({ key: `tab-${t.tab}`, group: 'Ir para', label: t.label, target: { kind: 'tab', tab: t.tab } }));
    const demandItems: PaletteItem[] = demands.map((d) => ({
      key: `demand-${d.id}`,
      group: 'Chamados',
      label: d.title,
      detail: d.client.name,
      target: { kind: 'demand', demandId: d.id },
    }));
    const clientItems: PaletteItem[] = clients.map((c) => ({
      key: `client-${c.id}`,
      group: 'Clientes',
      label: c.name,
      target: { kind: 'client', name: c.name },
    }));
    return term ? [...demandItems, ...clientItems, ...tabItems] : tabItems;
  }, [query, tabs, demands, clients]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onSelect(item.target);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const showEmpty = query.trim().length >= 2 && !searching && items.length === 0;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar chamados, clientes ou telas…"
            aria-label="Buscar chamados, clientes ou telas"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={items[activeIndex] ? `palette-item-${activeIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <span className="palette-hint">Buscando…</span>}
          <kbd className="palette-kbd">Esc</kbd>
        </div>

        <ul ref={listRef} id="palette-results" className="palette-results" role="listbox">
          {items.map((item, index) => {
            const showGroup = index === 0 || items[index - 1]?.group !== item.group;
            return (
              <li key={item.key} role="presentation">
                {showGroup && <div className="palette-group">{item.group}</div>}
                <div
                  id={`palette-item-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(item)}
                >
                  <span className="palette-item-label">{item.label}</span>
                  {item.detail && <span className="palette-item-detail">{item.detail}</span>}
                </div>
              </li>
            );
          })}
        </ul>

        {showEmpty && <p className="palette-empty">Nada encontrado para “{query.trim()}”.</p>}
        {query.trim().length < 2 && (
          <p className="palette-footer">Digite ao menos 2 letras para buscar chamados e clientes · ↑↓ para navegar · Enter para abrir</p>
        )}
      </div>
    </div>
  );
}
