import { Button, Select, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { EventData, Member } from '@rodzina/shared';
import { PageHeader } from '../../components/PageHeader.js';
import { labels } from '../../i18n/pl.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { EventForm } from './EventForm.js';
import { useCalendarMutations, useCalendarReadOnly } from './calendarQueries.js';

const text = labels.calendarUi;
const modes = ['single', 'recurring', 'distant'] as const;

export function CreateEventView({
  members,
  initialDate,
  timezone,
  onClose,
}: {
  members: Member[];
  initialDate: string;
  timezone: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<EventData['kind']>('single');
  const readOnly = useCalendarReadOnly();
  const { create } = useCalendarMutations();
  const changeKind = (value: string | null) => {
    if (modes.includes(value as EventData['kind']) && value !== kind && allowNavigation())
      setKind(value as EventData['kind']);
  };
  const cancel = () => {
    if (!create.isPending && allowNavigation()) onClose();
  };
  return (
    <Stack className="event-editor-page" gap="lg">
      <Button className="event-back" variant="subtle" onClick={cancel} disabled={create.isPending}>
        {text.back}
      </Button>
      <PageHeader title={text.add} description={text.formDescription} />
      <div className="event-kind-desktop" role="group" aria-label={text.chooseMode}>
        {modes.map((mode, index) => (
          <Button
            key={mode}
            variant="default"
            className="event-kind-card"
            aria-label={text.modeNames[mode]}
            aria-pressed={kind === mode}
            disabled={create.isPending}
            onClick={() => changeKind(mode)}
          >
            <span className="event-kind-icon" aria-hidden="true">
              {['▦', '↻', '⌁'][index]}
            </span>
            <span>
              <b>{text.modeNames[mode]}</b>
              <Text component="span" size="xs" c="dimmed">
                {text.modeDescriptions[mode]}
              </Text>
            </span>
            <span aria-hidden="true">{kind === mode ? '✓' : '○'}</span>
          </Button>
        ))}
      </div>
      <Select
        className="event-kind-mobile"
        label={text.chooseMode}
        value={kind}
        allowDeselect={false}
        disabled={create.isPending}
        data={modes.map((value) => ({ value, label: text.modeNames[value] }))}
        onChange={changeKind}
      />
      <EventForm
        key={kind}
        kind={kind}
        members={members}
        initialDate={initialDate}
        timezone={timezone}
        pending={create.isPending}
        readOnly={readOnly}
        onCancel={cancel}
        onSave={async (data) => {
          await create.mutateAsync(data);
          onClose();
        }}
      />
    </Stack>
  );
}
