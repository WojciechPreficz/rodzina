import { OfflineNotice } from '../../offline/OfflineNotice.js';
import { useOffline } from '../../connectivity.js';
import { calendarStore, useCalendarSnapshot } from './calendarOffline.js';

export function CalendarOfflineNotice({ syncedAt }: { syncedAt?: number | undefined }) {
  const offline = useOffline();
  useCalendarSnapshot();
  return (
    <OfflineNotice offline={offline} syncedAt={syncedAt} issue={calendarStore.issue}>
      Jesteś offline — kalendarz jest dostępny tylko do odczytu. Pokazujemy ostatnio zapisane dane.
    </OfflineNotice>
  );
}
