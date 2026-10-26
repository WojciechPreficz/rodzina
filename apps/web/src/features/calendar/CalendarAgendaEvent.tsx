import type { CalendarEventExternal } from '@schedule-x/calendar';
import type { CSSProperties } from 'react';
import { labels } from '../../i18n/pl.js';

export function CalendarAgendaEvent({
  calendarEvent,
}: {
  calendarEvent: CalendarEventExternal & { memberColor?: string; kind?: string };
}) {
  const { start, end } = calendarEvent;
  const timed = 'hour' in start && 'hour' in end;
  return (
    <div
      className="calendar-agenda-event"
      style={{ '--event-accent': calendarEvent.memberColor ?? '#426655' } as CSSProperties}
    >
      <div className="calendar-agenda-time">
        <b>
          {timed ? start.toLocaleString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : labels.calendarUi.allDay}
        </b>
        <small>
          {timed
            ? end.toLocaleString('pl-PL', {
                hour: '2-digit',
                minute: '2-digit',
                ...(start.toPlainDate().equals(end.toPlainDate()) ? {} : { day: 'numeric', month: 'short' }),
              })
            : start.toLocaleString('pl-PL', { day: 'numeric', month: 'short' })}
        </small>
      </div>
      <div className="calendar-agenda-content">
        <b>{calendarEvent.title}</b>
        {calendarEvent.location && <small>{calendarEvent.location}</small>}
        {!!calendarEvent.people?.length && <small>{calendarEvent.people.join(', ')}</small>}
        {calendarEvent.kind === 'recurring' && <small>{labels.calendarUi.modeNames.recurring}</small>}
      </div>
      <span aria-hidden="true" className="calendar-agenda-arrow">
        {calendarEvent.holiday ? 'ⓘ' : '↗'}
      </span>
    </div>
  );
}
