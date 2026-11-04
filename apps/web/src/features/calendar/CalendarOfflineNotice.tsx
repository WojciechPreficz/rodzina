import { OfflineNotice } from '../../offline/OfflineNotice.js';
import { useOffline } from '../../connectivity.js';
import { useCalendarOffline } from './calendarOffline.js';

export function CalendarOfflineNotice({ syncedAt }: { syncedAt?: number | undefined }) {
  const offline = useOffline();
  const { issue } = useCalendarOffline();
  return (
    <OfflineNotice offline={offline} syncedAt={syncedAt} issue={issue}>
      Jesteś offline — kalendarz jest dostępny tylko do odczytu. Pokazujemy ostatnio zapisane dane.
    </OfflineNotice>
  );
}
