import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import {
  calendarDateSchema,
  firstEventOccurrenceDate,
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
import type { Member } from '../family/familyApi.js';
import { labels } from '../../i18n/pl.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { isOffline, useOffline } from '../../connectivity.js';

const text = labels.calendarUi;

export function EventForm({
  event,
  kind = 'single',
  occurrenceOnly = false,
  members,
  initialDate,
  pending,
  readOnly = false,
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
  const [error, setError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>(() =>
    (event?.reminders ?? []).map((reminder) => ({ ...reminderInput(reminder), nextFireAt: reminder.nextFireAt })),
  );
  const [remindersChanged, setRemindersChanged] = useState(false);
  const [errors, setErrors] = useState<{
    title?: string | undefined;
    date?: string | undefined;
    time?: string | undefined;
  }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocked || isOffline()) return;
    const next = {
      title: title.trim() ? undefined : text.titleRequired,
      date: calendarDateSchema.safeParse(date).success ? undefined : text.dateInvalid,
      time:
        hasTime &&
        (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
          typeof duration !== 'number' ||
          !Number.isInteger(duration) ||
          duration < 1 ||
          duration > 525600)
          ? text.timeInvalid
          : undefined,
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
        durationMinutes: hasTime ? Number(duration) : null,
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
        <MultiSelect
          disabled={occurrenceOnly}
          label={text.participants}
          data={members.map((m) => ({ value: m.id, label: m.displayName }))}
          value={participants}
          onChange={(value) => {
            navigation.changed();
            setParticipants(value);
          }}
          searchable
        />
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
                setPrecision(value);
                if (value === 'month') setDate(`${date.slice(0, 7)}-01`);
              }
            }}
          />
        )}
        <Switch
          label={text.allDay}
          checked={allDay || monthly}
          disabled={monthly}
          onChange={(e) => setAllDay(e.currentTarget.checked)}
        />
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
            {hasTime && (
              <NumberInput
                label={text.duration}
                required
                min={1}
                max={525600}
                allowDecimal={false}
                value={duration}
                onChange={setDuration}
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
        {occurrenceOnly ? (
          <Text size="sm" c="dimmed">
            {text.reminderScope}
          </Text>
        ) : (
          <Stack>
            <Text fw={600}>{text.reminders}</Text>
            <Text size="sm" c="dimmed">
              {text.reminderAllDay}
            </Text>
            <ReminderList
              value={reminders}
              timezone="Europe/Warsaw"
              pending={pending || blocked}
              onRemove={(index) => {
                setReminders((current) => current.filter((_, i) => i !== index));
                setRemindersChanged(true);
                navigation.changed();
              }}
            />
            <ReminderPicker
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
          </Stack>
        )}
        <Group justify="flex-end">
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
