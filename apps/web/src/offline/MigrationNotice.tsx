import { useState } from 'react';
import { ensureMigrated } from './database.js';
import { reportStorageIssue, storageError, useMigrationRequired } from './status.js';

export function MigrationNotice({ onMigrated }: { onMigrated: () => Promise<void> }) {
  const required = useMigrationRequired();
  const [busy, setBusy] = useState(false);
  if (!required) return null;
  return (
    <div role="alert" className="offline-migration-notice">
      <p>
        Aktualizacja pamięci offline wymaga zamknięcia starszych kart. Zamknij wszystkie okna aplikacji i procesy
        przeglądarki, a następnie otwórz tę stronę bez przywracania starych kart. Nie otwieraj starszej wersji podczas
        przenoszenia danych.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await ensureMigrated(true);
            await onMigrated();
          } catch (error) {
            reportStorageIssue(`Nie udało się przenieść danych offline. ${storageError(error)}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        Potwierdzam zamknięcie starych kart — przenieś dane
      </button>
    </div>
  );
}
