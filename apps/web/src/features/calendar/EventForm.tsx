import { useState, type FormEvent } from 'react';
import { Alert, Button, Group, MultiSelect, NumberInput, Stack, Switch, Textarea, TextInput } from '@mantine/core';
import { calendarDateSchema, type CalendarEvent, type EventData } from '@rodzina/shared';
import type { Member } from '../family/familyApi.js';
import { labels } from '../../i18n/pl.js';

const text = labels.calendarUi;

export function EventForm({
  event,
  members,
  initialDate,
  pending,
  onSave,
  onCancel,
}: {
  event?: CalendarEvent;
  members: Member[];
  initialDate: string;
  pending: boolean;
  onSave: (data: EventData) => Promise<void>;
  onCancel: () => void;
}) {
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
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        participantIds: participants,
        startDate: date,
        startTime: allDay ? null : time,
        durationMinutes: allDay ? null : Number(duration),
        kind: event?.kind ?? 'single',
        datePrecision: event?.datePrecision ?? 'day',
        rrule: event?.rrule ?? null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.saveError);
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
          label={text.description}
          maxLength={10000}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <TextInput
          label={text.location}
          maxLength={500}
          value={location}
          onChange={(e) => setLocation(e.currentTarget.value)}
        />
        <MultiSelect
          label={text.participants}
          data={members.map((m) => ({ value: m.id, label: m.displayName }))}
          value={participants}
          onChange={setParticipants}
          searchable
        />
        <Switch
          label={text.allDay}
          checked={allDay}
          disabled={event?.datePrecision === 'month'}
          onChange={(e) => setAllDay(e.currentTarget.checked)}
        />
        <TextInput
          type={event?.datePrecision === 'month' ? 'month' : 'date'}
          label={text.date}
          required
          value={event?.datePrecision === 'month' ? date.slice(0, 7) : date}
          onChange={(e) =>
            setDate(event?.datePrecision === 'month' ? `${e.currentTarget.value}-01` : e.currentTarget.value)
          }
          error={errors.date}
        />
        {!allDay && (
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
