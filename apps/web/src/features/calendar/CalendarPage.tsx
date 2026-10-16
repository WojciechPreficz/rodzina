import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, MultiSelect, Stack, Text, Title } from '@mantine/core';
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react';
import { createViewDay, createViewMonthAgenda, createViewWeek } from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import { Temporal } from 'temporal-polyfill';
import { eventUrl, type EventData } from '@rodzina/shared';
import { useNavigate } from 'react-router';
import '@schedule-x/theme-default/dist/index.css';
import './calendar.css';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { useMembersQuery } from '../family/familyQueries.js';
import type { Member } from '../family/familyApi.js';
import { useCalendarMutations, useOccurrences } from './calendarQueries.js';
import { memberCalendars, monthRange, todayInTimezone, toScheduleX } from './toScheduleX.js';
import { EventForm } from './EventForm.js';
import { DistantEvents } from './DistantEvents.js';

const text = labels.calendarUi;

function CalendarView({ members, timezone }: { members: Member[]; timezone: string }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(() => todayInTimezone(timezone));
  const [range, setRange] = useState(() => monthRange(date));
  const [opened, setOpened] = useState(false);
  const [kind, setKind] = useState<EventData['kind'] | null>(null);
  const [ready, setReady] = useState(false);
  const [eventsService] = useState(() => createEventsServicePlugin());
  const occurrences = useOccurrences(range);
  const { create } = useCalendarMutations();
  const calendar = useCalendarApp({
    views: [createViewMonthAgenda(), createViewWeek(), createViewDay()],
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
    plugins: [eventsService],
  });
  useEffect(() => {
    if (!ready) return;
    eventsService.set(toScheduleX(occurrences.data ?? [], timezone, selected));
  }, [eventsService, occurrences.data, timezone, selected, ready]);

  return (
    <Stack>
      <MultiSelect
        label={text.showOnly}
        placeholder={text.allMembers}
        data={members.map((member) => ({ value: member.id, label: member.displayName }))}
        value={selected}
        onChange={setSelected}
        clearable
        searchable
      />
      <Group gap="xs">
        {members.map((member) => (
          <Badge key={member.id} color={member.color} variant="dot">
            {member.displayName}
          </Badge>
        ))}
      </Group>
      {occurrences.isPending && <Loader aria-label={text.loading} />}
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
      {occurrences.data && !occurrences.error && toScheduleX(occurrences.data, timezone, selected).length === 0 && (
        <Text c="dimmed">{text.noEvents}</Text>
      )}
      <Button className="calendar-add" aria-label={text.add} onClick={() => setOpened(true)}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="3" />
        </svg>
      </Button>
      <DistantEvents timezone={timezone} selected={selected} />
      <Modal
        opened={opened}
        onClose={() => {
          setOpened(false);
          setKind(null);
        }}
        title={kind ? text.modeNames[kind] : text.chooseMode}
      >
        {kind === null ? (
          <Stack>
            {(['single', 'recurring', 'distant'] as const).map((mode) => (
              <Button key={mode} variant="light" onClick={() => setKind(mode)}>
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
            onCancel={() => setKind(null)}
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
  return (
    <Stack>
      <Title order={2}>{labels.calendar}</Title>
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
      {members.isPending && <Loader aria-label={text.loading} />}
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
