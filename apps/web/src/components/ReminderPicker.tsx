import { useState } from 'react';
import { Alert, Badge, Button, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { calendarDateSchema, localDateTimeToUtc, type Reminder } from '@rodzina/shared';
import { labels } from '../i18n/pl.js';

import {
  describeReminder,
  eventReminderAudiences,
  presets,
  type ReminderInput,
  type ReminderItem,
} from './reminderFields.js';

const text = labels.calendarUi;
export function ReminderList({
  value,
  timezone,
  onRemove,
  pending = false,
  task = false,
}: {
  value: readonly ReminderItem[];
  timezone: string;
  onRemove?: (index: number) => void;
  pending?: boolean;
  task?: boolean;
}) {
  return (
    <Stack gap="xs">
      {value.length === 0 && (
        <Text c="dimmed" size="sm">
          {text.reminderEmpty}
        </Text>
      )}
      {value.map((reminder, index) => (
        <Group key={index} justify="space-between" wrap="wrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {task && reminder.type === 'offset' && reminder.offsetValue === 0
                ? labels.tasksUi.onDueDate
                : describeReminder(reminder, timezone)}{' '}
              ·{' '}
              {task && reminder.audience === 'owner'
                ? labels.tasksUi.reminderOwner
                : text.reminderAudiences[reminder.audience]}
            </Text>
            {reminder.type === 'absolute' && (reminder.nextFireAt === null || reminder.remindAt <= Date.now()) && (
              <Badge color="orange">{text.reminderStale}</Badge>
            )}
          </Stack>
          {onRemove && (
            <Button size="xs" color="red" variant="subtle" disabled={pending} onClick={() => onRemove(index)}>
              {text.reminderRemove}
            </Button>
          )}
        </Group>
      ))}
    </Stack>
  );
}

export function ReminderPicker({
  timezone = 'Europe/Warsaw',
  audiences = eventReminderAudiences,
  defaultAudience = 'participants',
  pending = false,
  task = false,
  onAdd,
}: {
  timezone?: string;
  audiences?: readonly Reminder['audience'][];
  defaultAudience?: Reminder['audience'];
  pending?: boolean;
  task?: boolean;
  onAdd: (reminder: ReminderInput) => void | Promise<void>;
}) {
  const [mode, setMode] = useState('0');
  const [audience, setAudience] = useState(defaultAudience);
  const [value, setValue] = useState<number | string>(1);
  const [unit, setUnit] = useState<'day' | 'week' | 'month'>('day');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const selectedAudience = audiences.includes(audience) ? audience : defaultAudience;
  async function add() {
    setError(null);
    let reminder: ReminderInput;
    try {
      if (mode === 'absolute') {
        if (!calendarDateSchema.safeParse(date).success) throw new RangeError();
        reminder = { type: 'absolute', remindAt: localDateTimeToUtc(date, time, timezone), audience: selectedAudience };
      } else if (mode === 'custom') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10000) throw new RangeError();
        reminder = { type: 'offset', offsetValue: value, offsetUnit: unit, audience: selectedAudience };
      } else {
        reminder = { type: 'offset', ...presets[Number(mode)]!, audience: selectedAudience };
      }
    } catch {
      setError(text.reminderInvalid);
      return;
    }
    setAdding(true);
    try {
      await onAdd(reminder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.saveError);
    } finally {
      setAdding(false);
    }
  }
  return (
    <Stack gap="xs">
      <Select
        label={text.reminderWhen}
        value={mode}
        allowDeselect={false}
        disabled={pending || adding}
        data={[
          ...(task
            ? [
                { value: '0', label: labels.tasksUi.onDueDate },
                { value: '3', label: text.reminderPresets[3] },
              ]
            : text.reminderPresets.map((label, index) => ({ value: String(index), label }))),
          { value: 'custom', label: text.reminderCustom },
          { value: 'absolute', label: text.reminderAbsolute },
        ]}
        onChange={(next) => {
          if (next) setMode(next);
        }}
      />
      {mode === 'custom' && (
        <Group grow align="start">
          <NumberInput
            label={text.reminderValue}
            min={0}
            max={10000}
            allowDecimal={false}
            value={value}
            onChange={setValue}
          />
          <Select
            label={text.reminderUnit}
            value={unit}
            allowDeselect={false}
            data={(['day', 'week', 'month'] as const).map((value) => ({ value, label: text.reminderUnits[value] }))}
            onChange={(next) => {
              if (next === 'day' || next === 'week' || next === 'month') setUnit(next);
            }}
          />
        </Group>
      )}
      {mode === 'absolute' && (
        <Group grow align="start">
          <TextInput
            type="date"
            label={text.reminderDate}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <TextInput
            type="time"
            label={text.reminderTime}
            value={time}
            onChange={(e) => setTime(e.currentTarget.value)}
          />
        </Group>
      )}
      <Select
        label={text.reminderAudience}
        value={selectedAudience}
        allowDeselect={false}
        disabled={pending || adding}
        data={audiences.map((value) => ({
          value,
          label: task && value === 'owner' ? labels.tasksUi.reminderOwner : text.reminderAudiences[value],
        }))}
        onChange={(next) => {
          const selected = audiences.find((value) => value === next);
          if (selected) setAudience(selected);
        }}
      />
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Button
        variant="light"
        disabled={pending}
        loading={adding}
        onClick={() => {
          void add();
        }}
      >
        {text.reminderAdd}
      </Button>
    </Stack>
  );
}
