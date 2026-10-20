import { Alert, Text } from '@mantine/core';
import { useOffline } from '../../connectivity.js';
import { calendarStore, useCalendarSnapshot } from './calendarOffline.js';

export function CalendarOfflineNotice({ syncedAt }: { syncedAt?: number | undefined }) {
  const offline = useOffline();
  useCalendarSnapshot();
  return (
    <>
      {offline && (
        <Alert color="yellow" role="status">
          Jesteś offline — kalendarz jest dostępny tylko do odczytu. Pokazujemy ostatnio zapisane dane.
          {syncedAt && <Text size="sm">Ostatnie udane pobranie: {new Date(syncedAt).toLocaleString('pl-PL')}</Text>}
        </Alert>
      )}
      {calendarStore.issue && <Alert color="red">{calendarStore.issue}</Alert>}
    </>
  );
}
