import { useState, type FormEvent } from 'react';
import { Alert, Button, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import {
  createDocumentSchema,
  DOCUMENT_TYPES,
  getDefaultDocumentReminders,
  sharedDocumentReminderSchema,
  type CreateDocument,
  type DocumentType,
  type FamilyDocument,
  type Member,
} from '@rodzina/shared';
import { ReminderList, ReminderPicker } from '../../components/ReminderPicker.js';
import { reminderInput, type ReminderItem } from '../../components/reminderFields.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { documentTypeLabels, hasHolder, hasVehicle } from './documentUi.js';

export function DocumentWarning() {
  return (
    <Alert color="yellow" title="Nie wpisuj numerów dokumentów">
      Przechowujemy wyłącznie daty ważności — bez skanów i bez numerów.
    </Alert>
  );
}

export function DocumentForm({
  document,
  members,
  timezone,
  pending,
  error,
  onSave,
  onCancel,
}: {
  document?: FamilyDocument | undefined;
  members: Member[];
  timezone: string;
  pending: boolean;
  error?: string | undefined;
  onSave: (data: CreateDocument) => Promise<void>;
  onCancel: () => void;
}) {
  const navigation = useFormNavigation();
  const [type, setType] = useState<DocumentType>(document?.type ?? 'id_card');
  const [label, setLabel] = useState(document?.label ?? '');
  const [holderUserId, setHolder] = useState<string | null>(document?.holderUserId ?? null);
  const [vehicleLabel, setVehicle] = useState(document?.vehicleLabel ?? '');
  const [expiresOn, setExpiry] = useState(document?.expiresOn ?? '');
  const [notes, setNotes] = useState(document?.notes ?? '');
  const [reminders, setReminders] = useState<ReminderItem[]>(() =>
    document
      ? document.reminders.map((item) => ({ ...reminderInput(item), nextFireAt: item.nextFireAt }))
      : getDefaultDocumentReminders(type),
  );
  const [remindersChanged, setRemindersChanged] = useState(false);
  const [invalid, setInvalid] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const result = createDocumentSchema.safeParse({
      type,
      label,
      holderUserId: hasHolder(type) ? holderUserId : null,
      vehicleLabel: hasVehicle(type) ? vehicleLabel.trim() || null : null,
      expiresOn,
      notes: notes.trim() || null,
      ...(!document || remindersChanged
        ? { reminders: reminders.map((item) => sharedDocumentReminderSchema.parse(reminderInputForSave(item))) }
        : {}),
    });
    setInvalid(!result.success);
    if (!result.success) return;
    await onSave(result.data);
  }
  return (
    <form data-navigation-guard="true" onChange={navigation.changed} onSubmit={(event) => void submit(event)}>
      <fieldset disabled={pending} className="document-fieldset">
        <Stack>
          <DocumentWarning />
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          {invalid && (
            <Alert color="red" role="alert">
              Sprawdź nazwę dokumentu, datę i przypomnienia.
            </Alert>
          )}
          <Select
            label="Typ dokumentu"
            value={type}
            allowDeselect={false}
            data={DOCUMENT_TYPES.map((value) => ({ value, label: documentTypeLabels[value] }))}
            onChange={(value) => {
              if (!value) return;
              const next = value as DocumentType;
              navigation.changed();
              setType(next);
              setHolder(null);
              setVehicle('');
              setReminders(getDefaultDocumentReminders(next));
              setRemindersChanged(true);
            }}
          />
          <TextInput
            label="Nazwa dokumentu"
            required
            maxLength={200}
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            data-autofocus
          />
          {hasHolder(type) && (
            <Select
              label="Posiadacz"
              placeholder="Bez posiadacza"
              clearable
              value={holderUserId}
              data={members.map((member) => ({ value: member.id, label: member.displayName }))}
              onChange={(value) => {
                navigation.changed();
                setHolder(value);
              }}
            />
          )}
          {hasVehicle(type) && (
            <TextInput
              label="Pojazd"
              placeholder="np. Skoda Octavia"
              maxLength={200}
              value={vehicleLabel}
              onChange={(e) => setVehicle(e.currentTarget.value)}
            />
          )}
          <TextInput
            type="date"
            label="Data ważności"
            required
            value={expiresOn}
            onChange={(e) => setExpiry(e.currentTarget.value)}
          />
          <Textarea
            label="Notatka"
            description="Bez numerów dokumentów i innych danych wrażliwych"
            autosize
            minRows={2}
            maxLength={10000}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
          />
          <Text fw={600}>Przypomnienia</Text>
          <Text size="sm" c="dimmed">
            Przypomnienia przed terminem pojawią się w APK o 09:00 ({timezone}). Posiadacz to wybrana osoba, a gdy jej
            brak — twórca dokumentu.
          </Text>
          <ReminderList
            document
            value={reminders}
            timezone={timezone}
            pending={pending}
            onRemove={(index) => {
              navigation.changed();
              setRemindersChanged(true);
              setReminders((current) => current.filter((_, position) => position !== index));
            }}
          />
          <ReminderPicker
            document
            timezone={timezone}
            audiences={['family', 'adults', 'owner']}
            defaultAudience="adults"
            pending={pending}
            onAdd={(reminder) => {
              if (reminders.length >= 20) throw new Error('Możesz dodać maksymalnie 20 przypomnień.');
              if (reminders.some((item) => JSON.stringify(reminderInputForSave(item)) === JSON.stringify(reminder)))
                return;
              navigation.changed();
              setRemindersChanged(true);
              setReminders((current) => [...current, reminder]);
            }}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                if (allowNavigation()) onCancel();
              }}
            >
              Anuluj
            </Button>
            <Button type="submit" loading={pending}>
              Zapisz
            </Button>
          </Group>
        </Stack>
      </fieldset>
    </form>
  );
}

function reminderInputForSave(item: ReminderItem) {
  return item.type === 'absolute'
    ? { type: item.type, remindAt: item.remindAt, audience: item.audience }
    : { type: item.type, offsetValue: item.offsetValue, offsetUnit: item.offsetUnit, audience: item.audience };
}
