/** Datas de calendário (YYYY-MM-DD) usadas nos prazos de entrega. */

export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'later';

export function formatCalendarDate(calendar: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendar);
  if (!m) return calendar;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function calendarToUtcDays(calendar: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendar);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/**
 * Prazo relativo ao "hoje" informado pelo servidor (fuso da agência), ex.: "atrasada há 2 dias",
 * "vence hoje", "amanhã", "em 5 dias". Até 3 dias à frente conta como "soon".
 */
export function relativeDeadline(deliveryDate: string, today: string): { label: string; tone: DeadlineTone } | null {
  const due = calendarToUtcDays(deliveryDate);
  const now = calendarToUtcDays(today);
  if (due === null || now === null) return null;
  const diff = Math.round(due - now);
  if (diff < 0) {
    const days = -diff;
    return { label: days === 1 ? 'atrasada há 1 dia' : `atrasada há ${days} dias`, tone: 'overdue' };
  }
  if (diff === 0) return { label: 'vence hoje', tone: 'today' };
  if (diff === 1) return { label: 'amanhã', tone: 'soon' };
  return { label: `em ${diff} dias`, tone: diff <= 3 ? 'soon' : 'later' };
}

/** "Hoje" no fuso da agência (o mesmo usado pelo Painel no backend). */
export function todayInAgency(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Cuiaba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
