import { Checkbox, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { describeRecurrence, wizardWeekdays, type RecurrenceWizard } from '@rodzina/shared';
import { labels } from '../../i18n/pl.js';

export function RecurrenceFields({
  value,
  onChange,
}: {
  value: RecurrenceWizard;
  onChange: (value: RecurrenceWizard) => void;
}) {
  const text = labels.calendarUi;
  let description = '';
  try {
    description = describeRecurrence(value);
  } catch {
    /* Incomplete wizard input. */
  }
  return (
    <Stack>
      <Group grow align="start">
        <NumberInput
          label={text.repeatEvery}
          min={1}
          allowDecimal={false}
          value={value.interval}
          onChange={(interval) => onChange({ ...value, interval: Number(interval) })}
        />
        <Select
          label={text.repeatUnit}
          allowDeselect={false}
          value={value.frequency}
          data={[
            { value: 'DAILY', label: text.dayUnit },
            { value: 'WEEKLY', label: text.weekUnit },
            { value: 'MONTHLY', label: text.monthUnit },
            { value: 'YEARLY', label: text.yearUnit },
          ]}
          onChange={(frequency) => {
            if (frequency) onChange({ ...value, frequency: frequency as RecurrenceWizard['frequency'] });
          }}
        />
      </Group>
      {value.frequency === 'WEEKLY' && (
        <Checkbox.Group
          label={text.weekdays}
          value={value.weekdays}
          onChange={(weekdays) => onChange({ ...value, weekdays: weekdays as RecurrenceWizard['weekdays'] })}
        >
          <Group mt="xs">
            {wizardWeekdays.map((day, index) => (
              <Checkbox key={day} value={day} label={text.weekdayNames[index]} />
            ))}
          </Group>
        </Checkbox.Group>
      )}
      <Select
        label={text.ending}
        allowDeselect={false}
        value={value.ending.type}
        data={[
          { value: 'never', label: text.never },
          { value: 'until', label: text.until },
          { value: 'count', label: text.afterCount },
        ]}
        onChange={(type) => {
          if (type === 'never') onChange({ ...value, ending: { type } });
          if (type === 'until') onChange({ ...value, ending: { type, date: '' } });
          if (type === 'count') onChange({ ...value, ending: { type, count: 10 } });
        }}
      />
      {value.ending.type === 'until' && (
        <TextInput
          type="date"
          label={text.untilDate}
          required
          value={value.ending.date}
          onChange={(e) => onChange({ ...value, ending: { type: 'until', date: e.currentTarget.value } })}
        />
      )}
      {value.ending.type === 'count' && (
        <NumberInput
          label={text.count}
          required
          min={1}
          allowDecimal={false}
          value={value.ending.count}
          onChange={(count) => onChange({ ...value, ending: { type: 'count', count: Number(count) } })}
        />
      )}
      {description && (
        <Text size="sm" c="dimmed" role="status">
          {description}
        </Text>
      )}
    </Stack>
  );
}
