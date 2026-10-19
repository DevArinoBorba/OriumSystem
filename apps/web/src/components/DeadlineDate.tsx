import { formatCalendarDate, relativeDeadline, todayInAgency } from '../dates.js';

/** Data de entrega em dd/mm/aaaa com o prazo relativo ao lado enquanto o item estiver aberto. */
export function DeadlineDate({ date, done = false }: { date: string; done?: boolean }) {
  const rel = done ? null : relativeDeadline(date, todayInAgency());
  return (
    <>
      {formatCalendarDate(date)}
      {rel && <span className={`deadline-chip ${rel.tone}`}>{rel.label}</span>}
    </>
  );
}
