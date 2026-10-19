import type { Task } from '@orium/contracts';

export function taskStatusLabel(status: Task['status']): string {
  const labels: Record<Task['status'], string> = {
    blocked: 'Aguardando',
    ready: 'Pronta',
    in_production: 'Em produção',
    in_review: 'Em revisão',
    changes_requested: 'Ajustes pedidos',
    paused: 'Pausada',
    completed: 'Concluída',
  };
  return labels[status];
}
