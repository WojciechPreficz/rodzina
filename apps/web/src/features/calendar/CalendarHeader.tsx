import type { CalendarConfig } from '@schedule-x/calendar';
import { Temporal } from 'temporal-polyfill';
import { labels } from '../../i18n/pl.js';

type CalendarContext = Parameters<NonNullable<NonNullable<CalendarConfig['callbacks']>['onRender']>>[0];

export function CalendarHeader({ $app }: { $app: CalendarContext }) {
  const date = $app.datePickerState.selectedDate.value;
  const view = $app.calendarState.view.value;
  const small = $app.calendarState.isCalendarSmall.value;
  const order = ['Month', 'Week', 'Day'];
  const views = $app.config.views.value
    .filter((item) => (small ? item.hasSmallScreenCompat : item.hasWideScreenCompat))
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  const current = views.find((item) => item.name === view);
  const range = $app.calendarState.range.value;
  const heading = view.includes('month')
    ? date.toLocaleString('pl-PL', { month: 'long', year: 'numeric' })
    : view === 'day'
      ? date.toLocaleString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
      : range
        ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', timeZone: 'UTC' }).formatRange(
            new Date(`${range.start.toPlainDate().toString()}T12:00:00Z`),
            new Date(`${range.end.toPlainDate().toString()}T12:00:00Z`),
          )
        : '';
  const move = (direction: number) => {
    if (!current) return;
    const next = current.backwardForwardFn(date, direction * current.backwardForwardUnits);
    $app.datePickerState.selectedDate.value = 'toPlainDate' in next ? next.toPlainDate() : next;
  };
  return (
    <div className="calendar-header">
      <div className="calendar-toolbar">
        <div className="calendar-period-navigation">
          <button type="button" aria-label={labels.calendarUi.previousPeriod} onClick={() => move(-1)}>
            ‹
          </button>
          <strong aria-live="polite">{heading}</strong>
          <button type="button" aria-label={labels.calendarUi.nextPeriod} onClick={() => move(1)}>
            ›
          </button>
        </div>
        <button
          type="button"
          className="calendar-today"
          onClick={() => {
            $app.datePickerState.selectedDate.value = Temporal.Now.plainDateISO($app.config.timezone.value);
          }}
        >
          {labels.calendarUi.todayAction}
        </button>
      </div>
      <div className="calendar-header-controls">
        <div className="calendar-view-tabs" role="group" aria-label={labels.calendarUi.view}>
          {views.map((item) => {
            const label = $app.translate(item.label);
            return (
              <button
                type="button"
                key={item.name}
                aria-label={`${labels.calendarUi.chooseView} ${label}`}
                aria-pressed={view === item.name}
                onClick={() => $app.calendarState.setView(item.name, date)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          className="calendar-date-input"
          type="date"
          aria-label={labels.calendarUi.chooseDate}
          data-testid="date-picker-input"
          value={date.toString()}
          onChange={(event) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(event.currentTarget.value))
              $app.datePickerState.selectedDate.value = Temporal.PlainDate.from(event.currentTarget.value);
          }}
        />
      </div>
    </div>
  );
}
