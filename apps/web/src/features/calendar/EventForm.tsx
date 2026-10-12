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
} from '@rodzina/shared';
import { RecurrenceFields } from './RecurrenceFields.js';
import type { Member } from '../family/familyApi.js';
import { labels } from '../../i18n/pl.js';

const text = labels.calendarUi;

export function EventForm({
  event,
  kind = 'single',
  occurrenceOnly = false,
  members,
  initialDate,
  pending,
  onSave,
  onCancel,
}: {
  event?: CalendarEvent;
  kind?: EventData['kind'];
  occurrenceOnly?: boolean;
  members: Member[];
  initialDate: string;
  pending: boolean;
  onSave: (data: EventData) => Promise<void>;
  onCancel: () => void;
}) {
  const eventKind = event?.kind ?? kind;
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
  const [time, setTime] = useState(event?.startTime ?? '09:00');
  const [duration, setDuration] = useState<number | string>(event?.durationMinutes ?? 60);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    title?: string | undefined;
    date?: string | undefined;
    time?: string | undefined;
  }>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      title: title.trim() ? undefined : text.titleRequired,
      date: calendarDateSchema.safeParse(date).success ? undefined : text.dateInvalid,
      time:
        !allDay &&
        !monthly &&
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
        startTime: allDay || monthly ? null : time,
        durationMinutes: allDay || monthly ? null : Number(duration),
        kind: eventKind,
        datePrecision: precision,
        rrule: rule,
      };
      if (eventKind === 'recurring' && !occurrenceOnly && !firstEventOccurrenceDate({ ...data, id: event?.id ?? '' })) {
        setError(text.recurrenceInvalid);
        return;
      }
      await onSave(data);
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
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <Stack>
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
          onChange={setParticipants}
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
              label={text.time}
              required
              value={time}
              onChange={(e) => setTime(e.currentTarget.value)}
              error={errors.time}
            />
            <NumberInput
              label={text.duration}
              required
              min={1}
              max={525600}
              allowDecimal={false}
              value={duration}
              onChange={setDuration}
            />
          </Group>
        )}
        {eventKind === 'recurring' &&
          !occurrenceOnly &&
          (wizard ? <RecurrenceFields value={wizard} onChange={setWizard} /> : <Alert>{text.unsupportedRule}</Alert>)}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={pending}>
            {labels.cancel}
          </Button>
          <Button type="submit" loading={pending}>
            {labels.save}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
