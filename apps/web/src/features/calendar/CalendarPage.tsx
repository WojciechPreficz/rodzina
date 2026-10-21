import { useEffect, useState } from 'react';
import { Alert, Box, Button, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react';
import { createViewDay, createViewMonthAgenda, createViewWeek, createViewWeekAgenda } from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import { Temporal } from 'temporal-polyfill';
import { eventUrl, type EventData } from '@rodzina/shared';
import { useNavigate } from 'react-router';
import '@schedule-x/theme-default/dist/index.css';
import './calendar.css';
import { useMe } from '../../auth.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { labels } from '../../i18n/pl.js';
import { useMembersQuery } from '../family/familyQueries.js';
import type { Member } from '@rodzina/shared';

import { calendarOnlineHint, useCalendarReadOnly, useCalendarMutations, useOccurrences } from './calendarQueries.js';
import { CalendarOfflineNotice } from './CalendarOfflineNotice.js';
import { useOffline } from '../../connectivity.js';
import { memberCalendars, monthRange, todayInTimezone, toScheduleX } from './toScheduleX.js';
import { EventForm } from './EventForm.js';
import { DistantEvents } from './DistantEvents.js';
import { NotificationBanner } from '../notifications/NotificationBanner.js';
import { TodayTasks } from '../tasks/TodayTasks.js';
import { createCalendarSwipePlugin } from './calendarSwipe.js';

const text = labels.calendarUi;

function createMobileWeekView() {
  const view = createViewWeekAgenda();
  view.label = 'Week';
  return view;
}

function CalendarView({ members, timezone }: { members: Member[]; timezone: string }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(() => todayInTimezone(timezone));
  const [range, setRange] = useState(() => monthRange(date));
  const [opened, setOpened] = useState(false);
  const [kind, setKind] = useState<EventData['kind'] | null>(null);
  const [ready, setReady] = useState(false);
  const [eventsService] = useState(() => createEventsServicePlugin());
  const [swipe] = useState(() => createCalendarSwipePlugin());
  const occurrences = useOccurrences(range);
  const readOnly = useCalendarReadOnly();
  const { create } = useCalendarMutations();
  const calendar = useCalendarApp({
    views: [createViewMonthAgenda(), createMobileWeekView(), createViewWeek(), createViewDay()],
    locale: 'pl-PL',
    timezone,
    firstDayOfWeek: 1,
    selectedDate: Temporal.PlainDate.from(date),
    calendars: memberCalendars(members),
    events: [],
    callbacks: {
      onRender: () => setReady(true),
      onRangeUpdate: ({ start, end }) =>
        setRange({ from: start.toPlainDate().toString(), to: end.toPlainDate().toString() }),
      onSelectedDateUpdate: (selectedDate) => setDate(selectedDate.toString()),
      onEventClick: (event) => navigate(eventUrl(String(event.eventId), String(event.occurrenceDate))),
    },
    plugins: [eventsService, swipe],
  });
  useEffect(() => {
    if (!ready) return;
    eventsService.set(toScheduleX(occurrences.data ?? [], timezone, selected));
  }, [eventsService, occurrences.data, timezone, selected, ready]);

  return (
    <Stack>
      <CalendarOfflineNotice syncedAt={occurrences.syncedAt} />
      <NotificationBanner />
      <Stack gap="xs">
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
              size="compact-sm"
              mih={36}
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
        {selected.length === 0 && (
          <Text size="xs" c="dimmed">
            {text.allMembers}
          </Text>
        )}
      </Stack>
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
        <ScheduleXCalendar calendarApp={calendar} />
      </div>
      {occurrences.coverage === 'complete' &&
        !occurrences.error &&
        toScheduleX(occurrences.data, timezone, selected).length === 0 && <Text c="dimmed">{text.noEvents}</Text>}
      {readOnly && (
        <Text size="sm" c="dimmed">
          {calendarOnlineHint}
        </Text>
      )}
      <Button
        className="calendar-add"
        aria-label={text.add}
        disabled={readOnly}
        title={readOnly ? calendarOnlineHint : undefined}
        onClick={() => setOpened(true)}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="3" />
        </svg>
      </Button>
      <DistantEvents timezone={timezone} selected={selected} />
      <Modal
        opened={opened}
        onClose={() => {
          if (!allowNavigation()) return;
          setOpened(false);
          setKind(null);
        }}
        title={kind ? text.modeNames[kind] : text.chooseMode}
      >
        {kind === null ? (
          <Stack>
            {(['single', 'recurring', 'distant'] as const).map((mode) => (
              <Button key={mode} variant="light" disabled={readOnly} onClick={() => setKind(mode)}>
                {text.modeNames[mode]}
              </Button>
            ))}
          </Stack>
        ) : (
          <EventForm
            kind={kind}
            members={members}
            initialDate={date}
            pending={create.isPending}
            readOnly={readOnly}
            onCancel={() => {
              if (allowNavigation()) setKind(null);
            }}
            onSave={async (data) => {
              await create.mutateAsync(data);
              setOpened(false);
              setKind(null);
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}

export function CalendarPage() {
  const { family } = useMe();
  const members = useMembersQuery();
  const offline = useOffline();
  return (
    <Stack>
      <Title order={2}>{labels.calendar}</Title>
      <TodayTasks />
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
      {family && members.data && (
        <CalendarView
          key={JSON.stringify(members.data.map((m) => [m.id, m.displayName, m.color]))}
          members={members.data}
          timezone={family.timezone}
        />
      )}
    </Stack>
  );
}
