import { Badge, Modal, Stack, Text } from '@mantine/core';
import { Temporal } from 'temporal-polyfill';
import { labels } from '../../i18n/pl.js';
import { holidayColors } from './holidayLayers.js';
import type { PolishHoliday } from './polishHolidays.js';

export function HolidayDetails({ holiday, onClose }: { holiday: PolishHoliday | null; onClose: () => void }) {
  const text = labels.calendarUi;
  return (
    <Modal
      opened={holiday !== null}
      onClose={onClose}
      title={holiday?.name}
      centered
      closeButtonProps={{ 'aria-label': 'Zamknij' }}
    >
      {holiday && (
        <Stack gap="sm">
          <Badge color={holidayColors[holiday.category]}>{text.holidayCategories[holiday.category]}</Badge>
          <Text>
            {Temporal.PlainDate.from(holiday.date).toLocaleString('pl-PL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Text>
          <Text>
            {holiday.category === 'publicHoliday' ? text.publicHolidayDescription : text.observanceDescription}
          </Text>
          {holiday.key === 'teachers-day' && (
            <Text size="sm" c="dimmed">
              {text.teachersDayDescription}
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
