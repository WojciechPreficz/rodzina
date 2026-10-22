import { useState, type FormEvent } from 'react';
import { Temporal } from 'temporal-polyfill';
import { Alert, Button, Group, NumberInput, Select, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import {
  calendarDateSchema,
  firstEventOccurrenceDate,
  localDateTimeToUtc,
  defaultRecurrenceWizard,
  rruleFromWizard,
  wizardFromRrule,
  type CalendarEvent,
  type EventData,
  type SharedEventReminder,
} from '@rodzina/shared';
import { ReminderList, ReminderPicker } from '../../components/ReminderPicker.js';
import { reminderInput, type ReminderItem } from '../../components/reminderFields.js';
import { RecurrenceFields } from './RecurrenceFields.js';
import type { Member } from '@rodzina/shared';

import { labels } from '../../i18n/pl.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { EventSection } from './EventSection.js';
import './event.css';

const text = labels.calendarUi;

export function EventForm({
  event,
  kind = 'single',
  occurrenceOnly = false,
  members,
  initialDate,
  pending,
  readOnly = false,
  timezone = 'Europe/Warsaw',
  onSave,
  onCancel,
}: {
  event?: CalendarEvent;
  kind?: EventData['kind'];
  occurrenceOnly?: boolean;
  members: Member[];
  initialDate: string;
  pending: boolean;
  readOnly?: boolean;
  timezone?: string;
  onSave: (data: EventData) => Promise<void>;
  onCancel: () => void;
}) {
  const eventKind = event?.kind ?? kind;
  const offline = useOffline();
  const blocked = readOnly || offline;
  const navigation = useFormNavigation();
  const [precision, setPrecision] = useState<'day' | 'month'>(event?.datePrecision ?? 'day');
  const monthly = eventKind === 'distant' && precision === 'month';
  const initialWizard = event?.rrule
    ? wizardFromRrule(event.rrule, event.startDate)
    : defaultRecurrenceWizard(initialDate);
  const [wizard, setWizard] = useState(initialWizard);
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [participants, setParticipants] = useState(event?.participants.map((p) => p.id) ?? []);
  const [allDay, setAllDay] = useState(event ? event.startTime === null : false);
  const [date, setDate] = useState(event?.startDate ?? initialDate);
  const [time, setTime] = useState(event?.startTime ?? (eventKind === 'distant' ? '' : '09:00'));
  const hasTime = !allDay && !monthly && (eventKind !== 'distant' || time !== '');
  const [duration, setDuration] = useState<number | string>(event?.durationMinutes ?? 60);
  const initialStart = Temporal.PlainDate.from(event?.startDate ?? initialDate);
  const initialEnd = event?.startTime
    ? Temporal.Instant.fromEpochMilliseconds(
        localDateTimeToUtc(event.startDate, event.startTime, timezone) + (event.durationMinutes ?? 60) * 60000,
      ).toZonedDateTimeISO(timezone)
    : null;
  const initialEndDate = initialEnd
    ? initialEnd.toPlainDate()
    : initialStart.add({ days: Math.max(0, (event?.durationMinutes ?? 1440) / 1440 - 1) });
  const [multiDay, setMultiDay] = useState(eventKind === 'single' && !initialEndDate.equals(initialStart));
  const [endDate, setEndDate] = useState(initialEndDate.toString());
  const [endTime, setEndTime] = useState(initialEnd?.toPlainTime().toString().slice(0, 5) ?? '10:00');
  const [error, setError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>(() =>
    (event?.reminders ?? []).map((reminder) => ({ ...reminderInput(reminder), nextFireAt: reminder.nextFireAt })),
  );
  const [remindersChanged, setRemindersChanged] = useState(false);
  const [errors, setErrors] = useState<{
    title?: string | undefined;
    date?: string | undefined;
    time?: string | undefined;
    endDate?: string | undefined;
  }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocked || isOffline()) return;
    let selectedDuration: number | null = hasTime ? Number(duration) : null;
    let endError: string | undefined;
    if (multiDay) {
      try {
        if (!calendarDateSchema.safeParse(endDate).success || !calendarDateSchema.safeParse(date).success)
          throw new RangeError();
        selectedDuration = allDay
          ? (Temporal.PlainDate.from(date).until(Temporal.PlainDate.from(endDate)).days + 1) * 1440
          : (localDateTimeToUtc(endDate, endTime, timezone) - localDateTimeToUtc(date, time, timezone)) / 60000;
        if (endDate < date || selectedDuration < 1 || selectedDuration > 525600) throw new RangeError();
      } catch {
        endError = text.endInvalid;
      }
    }
    const next = {
      title: title.trim() ? undefined : text.titleRequired,
      date: calendarDateSchema.safeParse(date).success ? undefined : text.dateInvalid,
      time:
        hasTime &&
        (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
          (!multiDay &&
            (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 525600)))
          ? text.timeInvalid
          : undefined,
      endDate: endError,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setError(null);
    try {
      let rule = event?.rrule ?? null;
      if (eventKind === 'recurring' && !occurrenceOnly && wizard) {
        if (wizard.ending.type === 'until' && wizard.ending.date < date) {
          setError(text.recurrenceInvalid);
          return;
        }
        // Preserve existing rules exactly unless the user changes wizard settings.
        rule =
          event?.rrule && JSON.stringify(wizard) === JSON.stringify(initialWizard)
            ? event.rrule
            : rruleFromWizard(wizard);
      }
      const data: EventData = {
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        participantIds: participants,
        startDate: date,
        startTime: hasTime ? time : null,
        durationMinutes: selectedDuration,
        kind: eventKind,
        datePrecision: precision,
        rrule: rule,
      };
      if (!occurrenceOnly && remindersChanged) {
        data.reminders = reminders.map((reminder) => {
          if (reminder.audience === 'user' || reminder.audience === 'list_members')
            throw new Error(text.reminderInvalid);
          return reminder.type === 'absolute'
            ? { type: 'absolute', remindAt: reminder.remindAt, audience: reminder.audience }
            : {
                type: 'offset',
                offsetValue: reminder.offsetValue,
                offsetUnit: reminder.offsetUnit,
                audience: reminder.audience,
              };
        }) satisfies SharedEventReminder[];
      }
      if (eventKind === 'recurring' && !occurrenceOnly && !firstEventOccurrenceDate({ ...data, id: event?.id ?? '' })) {
        setError(text.recurrenceInvalid);
        return;
      }
      navigation.saved();
      try {
        await onSave(data);
      } catch (error) {
        navigation.changed();
        throw error;
      }
    } catch (cause) {
      setError(
        cause instanceof RangeError || (cause instanceof Error && cause.name === 'ZodError')
          ? text.recurrenceInvalid
          : cause instanceof Error
            ? cause.message
            : labels.saveError,
      );
    }
  }

  return (
    <form
      className="event-form"
      aria-label={event ? text.editEvent : text.add}
      data-navigation-guard="true"
      onChangeCapture={navigation.changed}
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <Stack>
        {blocked && <Text size="sm">Dostępne po połączeniu z internetem</Text>}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <div className="event-form-grid">
          <Stack className="event-form-main" gap="lg">
            <EventSection title={text.eventDetails} number="01">
              <TextInput
                label={text.title}
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                error={errors.title}
              />
              <Textarea
                disabled={occurrenceOnly}
                label={text.description}
                maxLength={10000}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
              <TextInput
                label={text.location}
                disabled={occurrenceOnly}
                maxLength={500}
                value={location}
                onChange={(e) => setLocation(e.currentTarget.value)}
              />
            </EventSection>
            <EventSection title={text.eventDate} number="02">
              {occurrenceOnly && (
                <Text size="sm" c="dimmed">
                  {text.occurrenceFieldsNotice}
                </Text>
              )}
              {eventKind === 'distant' && (
                <Select
                  label={text.precision}
                  value={precision}
                  allowDeselect={false}
                  data={[
                    { value: 'day', label: text.precisionDay },
                    { value: 'month', label: text.precisionMonth },
                  ]}
                  onChange={(value) => {
                    if (value === 'day' || value === 'month') {
                      navigation.changed();
                      setPrecision(value);
                      if (value === 'month') setDate(`${date.slice(0, 7)}-01`);
                    }
                  }}
                />
              )}
              <Group>
                <Switch
                  label={text.allDay}
                  checked={allDay || monthly}
                  disabled={monthly}
                  onChange={(e) => setAllDay(e.currentTarget.checked)}
                />
                {eventKind === 'single' && (
                  <Switch
                    label={text.multiDay}
                    checked={multiDay}
                    onChange={(e) => {
                      setMultiDay(e.currentTarget.checked);
                      if (!e.currentTarget.checked) setDuration(60);
                      if (e.currentTarget.checked && endDate <= date && calendarDateSchema.safeParse(date).success)
                        setEndDate(Temporal.PlainDate.from(date).add({ days: 1 }).toString());
                    }}
                  />
                )}
              </Group>
              <TextInput
                type={monthly ? 'month' : 'date'}
                label={text.date}
                required
                value={monthly ? date.slice(0, 7) : date}
                onChange={(e) => setDate(monthly ? `${e.currentTarget.value}-01` : e.currentTarget.value)}
                error={errors.date}
              />
              {!allDay && !monthly && (
                <Group grow align="start">
                  <TextInput
                    type="time"
                    label={eventKind === 'distant' ? text.optionalTime : text.time}
                    required={eventKind !== 'distant'}
                    value={time}
                    onChange={(e) => setTime(e.currentTarget.value)}
                    error={errors.time}
                  />
                  {hasTime && !multiDay && (
                    <NumberInput
                      label={text.duration}
                      styles={{ label: { whiteSpace: 'nowrap' } }}
                      required
                      min={1}
                      max={525600}
                      allowDecimal={false}
                      value={duration}
                      onChange={(value) => {
                        navigation.changed();
                        setDuration(value);
                      }}
                    />
                  )}
                </Group>
              )}
              {multiDay && (
                <Group grow align="start">
                  <TextInput
                    type="date"
                    label={text.endDate}
                    required
                    min={date}
                    value={endDate}
                    onChange={(e) => setEndDate(e.currentTarget.value)}
                    error={errors.endDate}
                  />
                  {!allDay && (
                    <TextInput
                      type="time"
                      label={text.endTime}
                      required
                      value={endTime}
                      onChange={(e) => setEndTime(e.currentTarget.value)}
                    />
                  )}
                </Group>
              )}
              {eventKind === 'recurring' &&
                !occurrenceOnly &&
                (wizard ? (
                  <RecurrenceFields
                    value={wizard}
                    onChange={(value) => {
                      navigation.changed();
                      setWizard(value);
                    }}
                  />
                ) : (
                  <Alert>{text.unsupportedRule}</Alert>
                ))}
            </EventSection>
            <EventSection title={text.participants} number="03">
              <Group role="group" aria-label={text.participants} gap="xs">
                {members.map((member) => (
                  <Button
                    key={member.id}
                    variant="default"
                    radius="xl"
                    className="event-participant"
                    disabled={occurrenceOnly || pending}
                    aria-pressed={participants.includes(member.id)}
                    leftSection={
                      <span className="event-participant-dot" aria-hidden="true" style={{ background: member.color }} />
                    }
                    rightSection={<span aria-hidden="true">{participants.includes(member.id) ? '✓' : '+'}</span>}
                    onClick={() => {
                      navigation.changed();
                      setParticipants((current) =>
                        current.includes(member.id)
                          ? current.filter((id) => id !== member.id)
                          : [...current, member.id],
                      );
                    }}
                  >
                    {member.displayName}
                  </Button>
                ))}
              </Group>
              {!members.length && (
                <Text size="sm" c="dimmed">
                  {text.noParticipants}
                </Text>
              )}
              <Text size="sm" c="dimmed">
                {text.participantsHint}
              </Text>
            </EventSection>
          </Stack>
          <aside className="event-form-aside">
            <EventSection title={text.reminders}>
              {occurrenceOnly ? (
                <Text size="sm" c="dimmed">
                  {text.reminderScope}
                </Text>
              ) : (
                <Stack>
                  <Text size="sm" c="dimmed">
                    {text.reminderAndroidHint}
                  </Text>
                  <ReminderList
                    value={reminders}
                    timezone={timezone}
                    pending={pending || blocked}
                    onRemove={(index) => {
                      setReminders((current) => current.filter((_, i) => i !== index));
                      setRemindersChanged(true);
                      navigation.changed();
                    }}
                  />
                  <ReminderPicker
                    timezone={timezone}
                    pending={pending || blocked || reminders.length >= 100}
                    onAdd={(reminder) => {
                      setReminders((current) => [...current, reminder]);
                      navigation.changed();
                      setRemindersChanged(true);
                    }}
                  />
                  <Text size="sm" c="dimmed">
                    {text.reminderHint}
                  </Text>
                  {(allDay || monthly) && (
                    <Text size="sm" c="dimmed">
                      {text.reminderAllDay}
                    </Text>
                  )}
                </Stack>
              )}
            </EventSection>
          </aside>
        </div>
        <Group justify="flex-end" className="event-form-actions">
          <Button variant="default" onClick={onCancel} disabled={pending}>
            {labels.cancel}
          </Button>
          <Button type="submit" loading={pending} disabled={blocked}>
            {labels.save}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
