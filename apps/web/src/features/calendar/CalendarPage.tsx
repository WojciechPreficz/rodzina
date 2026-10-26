import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert, Box, Button, Group, Loader, Stack, Switch, Text } from '@mantine/core';
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react';
import {
  createViewDay,
  createViewMonthGrid,
  createViewMonthAgenda,
  createViewWeek,
  createViewWeekAgenda,
} from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import { Temporal } from 'temporal-polyfill';
import { eventUrl } from '@rodzina/shared';
import { useLocation, useNavigate } from 'react-router';
import '@schedule-x/theme-default/dist/index.css';
import './calendar.css';
import { useMe } from '../../auth.js';
import { PageHeader } from '../../components/PageHeader.js';
import { labels } from '../../i18n/pl.js';
import { useMembersQuery } from '../family/familyQueries.js';
import type { Member } from '@rodzina/shared';

import { calendarOnlineHint, useCalendarReadOnly, useOccurrences } from './calendarQueries.js';
import { CalendarOfflineNotice } from './CalendarOfflineNotice.js';
import { useOffline } from '../../connectivity.js';
import { memberCalendars, monthRange, todayInTimezone, toScheduleX } from './toScheduleX.js';
import { CreateEventView } from './CreateEventView.js';
import { DistantEvents } from './DistantEvents.js';
import { NotificationBanner } from '../notifications/NotificationBanner.js';
import { TodayTasks } from '../tasks/TodayTasks.js';
import { createCalendarSwipePlugin } from './calendarSwipe.js';
import { CalendarHeader } from './CalendarHeader.js';
import { CalendarAgendaEvent } from './CalendarAgendaEvent.js';
import { isHolidayRangeSupported, polishHolidaysInRange, type PolishHoliday } from './polishHolidays.js';
import { holidayCalendars, holidaysToScheduleX, readHolidayLayers, saveHolidayLayers } from './holidayLayers.js';
import { HolidayDetails } from './HolidayDetails.js';

const text = labels.calendarUi;
// The adapter destroys the calendar when this object changes identity.
const calendarComponents = {
  headerContent: CalendarHeader,
  monthAgendaEvent: CalendarAgendaEvent,
  weekAgendaEvent: CalendarAgendaEvent,
};

function createMobileWeekView() {
  const view = createViewWeekAgenda();
  view.label = 'Week';
  return view;
}

function CalendarView({
  members,
  timezone,
  date,
  setDate,
  selected,
  setSelected,
  onCreate,
}: {
  members: Member[];
  timezone: string;
  date: string;
  setDate: (date: string) => void;
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  onCreate: () => void;
}) {
  const navigate = useNavigate();
  const [range, setRange] = useState(() => monthRange(date));
  const [ready, setReady] = useState(false);
  const [eventsService] = useState(() => createEventsServicePlugin());
  const [swipe] = useState(() => createCalendarSwipePlugin());
  const occurrences = useOccurrences(range);
  const readOnly = useCalendarReadOnly();
  const [layers, setLayers] = useState(readHolidayLayers);
  const [holidayDetails, setHolidayDetails] = useState<PolishHoliday | null>(null);
  const calendar = useCalendarApp({
    views: [createViewMonthAgenda(), createViewMonthGrid(), createMobileWeekView(), createViewWeek(), createViewDay()],
    defaultView: 'month-grid',
    locale: 'pl-PL',
    timezone,
    firstDayOfWeek: 1,
    selectedDate: Temporal.PlainDate.from(date),
    calendars: { ...memberCalendars(members), ...holidayCalendars() },
    events: [],
    callbacks: {
      onRender: () => setReady(true),
      onRangeUpdate: ({ start, end }) =>
        setRange({ from: start.toPlainDate().toString(), to: end.toPlainDate().toString() }),
      onSelectedDateUpdate: (selectedDate) => setDate(selectedDate.toString()),
      onEventClick: (event) => {
        if (event.holiday) setHolidayDetails(event.holiday as PolishHoliday);
        else navigate(eventUrl(String(event.eventId), String(event.occurrenceDate)));
      },
    },
    plugins: [eventsService, swipe],
  });
  useEffect(() => {
    if (!ready) return;
    eventsService.set([
      ...toScheduleX(occurrences.data ?? [], timezone, selected),
      ...holidaysToScheduleX(polishHolidaysInRange(range), layers),
    ]);
  }, [eventsService, occurrences.data, timezone, selected, ready, range, layers]);

  return (
    <Stack className="calendar-page" gap="lg">
      <PageHeader
        title={labels.calendar}
        description={Temporal.PlainDate.from(date).toLocaleString('pl-PL', { month: 'long', year: 'numeric' })}
        actions={
          <Button
            className="calendar-add"
            aria-label={text.add}
            disabled={readOnly}
            title={readOnly ? calendarOnlineHint : undefined}
            onClick={onCreate}
          >
            <span aria-hidden="true" className="calendar-add-icon">
              ＋
            </span>
            <span className="calendar-add-label">{text.add}</span>
          </Button>
        }
      />
      <CalendarOfflineNotice syncedAt={occurrences.syncedAt} />
      <NotificationBanner />
      <TodayTasks />
      <div className="calendar-filters">
        <Text size="sm" fw={500} id="calendar-member-filter-label">
          {text.showOnly}
        </Text>
        <Group gap="xs" role="group" aria-labelledby="calendar-member-filter-label">
          {members.map((member) => (
            <Button
              key={member.id}
              type="button"
              color={member.color}
              variant={selected.includes(member.id) ? 'light' : 'default'}
              radius="xl"
              className="calendar-member-filter"
              style={{ '--member-color': member.color }}
              mih={44}
              aria-pressed={selected.includes(member.id)}
              leftSection={<Box aria-hidden="true" w={8} h={8} bg={member.color} style={{ borderRadius: '50%' }} />}
              rightSection={selected.includes(member.id) ? <span aria-hidden="true">✓</span> : undefined}
              onClick={() =>
                setSelected((current) =>
                  current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id],
                )
              }
            >
              {member.displayName}
            </Button>
          ))}
        </Group>
        <Text size="xs" c="dimmed" className="calendar-filter-summary">
          {selected.length === 0 ? text.allMembers : text.selectedMembers}
        </Text>
      </div>
      <Group className="calendar-holiday-layers" gap="lg" role="group" aria-label={text.holidayLayers}>
        {(['publicHoliday', 'observance'] as const).map((category) => (
          <Switch
            key={category}
            label={category === 'publicHoliday' ? text.publicHolidays : text.observances}
            checked={layers[category]}
            onChange={(event) => {
              const next = { ...layers, [category]: event.currentTarget.checked };
              setLayers(next);
              saveHolidayLayers(next);
            }}
          />
        ))}
      </Group>
      {!isHolidayRangeSupported(range) && <Alert color="yellow">{text.holidayRangeUnsupported}</Alert>}
      {occurrences.isFetching && occurrences.coverage === 'missing' && <Loader aria-label={text.loading} />}
      {occurrences.coverage && occurrences.coverage !== 'complete' && (
        <Alert color="yellow">
          {occurrences.coverage === 'partial' && 'Zapisane dane są częściowe. '}
          Ten zakres nie został zapisany offline. Połącz się z internetem, aby go pobrać.
        </Alert>
      )}
      {occurrences.error && (
        <Alert color="red" role="alert">
          {occurrences.error.message}
          <Button
            onClick={() => {
              void occurrences.refetch();
            }}
          >
            {text.retry}
          </Button>
        </Alert>
      )}
      <div className="family-calendar">
        <ScheduleXCalendar calendarApp={calendar} customComponents={calendarComponents} />
      </div>
      {occurrences.coverage === 'complete' &&
        !occurrences.error &&
        toScheduleX(occurrences.data, timezone, selected).length === 0 && <Text c="dimmed">{text.noFamilyEvents}</Text>}
      {readOnly && (
        <Text size="sm" c="dimmed">
          {calendarOnlineHint}
        </Text>
      )}
      <DistantEvents timezone={timezone} selected={selected} />
      <HolidayDetails holiday={holidayDetails} onClose={() => setHolidayDetails(null)} />
    </Stack>
  );
}

export function CalendarPage() {
  const { family } = useMe();
  const members = useMembersQuery();
  const offline = useOffline();
  const location = useLocation();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedDate, setDate] = useState<string>();
  const date = selectedDate ?? todayInTimezone(family?.timezone ?? 'Europe/Warsaw');
  const creating = location.state?.calendarCreate === true;
  const scrollPosition = useRef(0);
  const wasCreating = useRef(creating);
  useEffect(() => {
    if (creating === wasCreating.current) return;
    wasCreating.current = creating;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, creating ? 0 : scrollPosition.current);
      if (!creating) document.querySelector<HTMLButtonElement>('.calendar-add')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [creating]);
  return (
    <Stack>
      {(!family || !members.data) && (
        <>
          <PageHeader title={labels.calendar} />
          <TodayTasks />
        </>
      )}
      {members.error && (
        <Alert color="red" role="alert">
          {members.error.message}
          <Button
            onClick={() => {
              void members.refetch();
            }}
          >
            {text.retry}
          </Button>
        </Alert>
      )}
      {!members.data && <CalendarOfflineNotice />}
      {!members.data && offline && (
        <Text>Brak danych kalendarza zapisanych na tym urządzeniu. Połącz się z internetem, aby je pobrać.</Text>
      )}
      {members.isPending && !offline && <Loader aria-label={text.loading} />}
      {family &&
        members.data &&
        (creating ? (
          <CreateEventView
            members={members.data}
            initialDate={date}
            timezone={family.timezone}
            onClose={() => {
              void navigate(-1);
            }}
          />
        ) : (
          <CalendarView
            key={JSON.stringify(members.data.map((m) => [m.id, m.displayName, m.color]))}
            members={members.data}
            timezone={family.timezone}
            date={date}
            setDate={setDate}
            selected={selected}
            setSelected={setSelected}
            onCreate={() => {
              scrollPosition.current = window.scrollY;
              void navigate(`${location.pathname}${location.search}`, { state: { calendarCreate: true } });
            }}
          />
        ))}
    </Stack>
  );
}
