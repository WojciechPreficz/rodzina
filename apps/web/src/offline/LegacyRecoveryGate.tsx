import { useEffect, useState, type ReactNode } from 'react';
import { hasPendingClear } from './database.js';
import { isLegacySource, needsLegacyRecovery } from './legacySources.js';
import { storageError } from './status.js';
import { StorageBlockedError } from './idb.js';

const recoveryParameter = 'odzyskaj-dane-offline';

export function LegacyRecoveryGate({ children }: { children: ReactNode }) {
  const [required, setRequired] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState<string>();
  const url = new URL(window.location.href);
  const recovering = url.searchParams.has(recoveryParameter);

  useEffect(() => {
    if (recovering) return;
    let current = true;
    const onStorage = ({ key, newValue }: StorageEvent) => {
      if (key && newValue !== null && !hasPendingClear() && isLegacySource(key)) setRequired(true);
    };
    window.addEventListener('storage', onStorage);
    void needsLegacyRecovery().then(
      (needed) => {
        if (current) setRequired((alreadyRequired) => alreadyRequired || needed);
      },
      (cause: unknown) => {
        if (!current) return;
        if (cause instanceof StorageBlockedError) {
          setBlocked(cause.message);
          return;
        }
        // The account lifecycle reports storage failures and can still serve online data.
        if (current) setRequired((alreadyRequired) => alreadyRequired ?? false);
      },
    );
    return () => {
      current = false;
      window.removeEventListener('storage', onStorage);
    };
  }, [recovering]);

  if (blocked)
    return (
      <main className="offline-storage-notices">
        <div className="offline-storage-error" role="alert">
          {blocked}
        </div>
        <button onClick={() => window.location.reload()}>Ponów próbę</button>
      </main>
    );
  if (!recovering && required === undefined) return null;
  if (!recovering && !required) return children;

  const recoveryUrl = new URL(url);
  recoveryUrl.searchParams.set(recoveryParameter, '1');
  url.searchParams.delete(recoveryParameter);
  return (
    <main className="offline-storage-notices">
      <div className="offline-migration-notice">
        <h1>Odzyskiwanie danych offline</h1>
        {recovering ? (
          <>
            <p>
              Zamknij pozostałe karty aplikacji i pozostaw otwartą tylko tę stronę. Użyj tego samego profilu
              przeglądarki lub tej samej instalacji aplikacji, w której zapisano dane.
            </p>
            <p>
              Po odzyskaniu połącz się z internetem i sprawdź synchronizację na tym samym koncie. Zmiany starsze niż 30
              dni mogą wymagać ręcznego odtworzenia.
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  const { recoverLegacyData } = await import('./legacyRecovery.js');
                  await recoverLegacyData();
                  if (await needsLegacyRecovery()) {
                    throw new Error('Nadal wykryto stare dane. Zamknij pozostałe karty i ponów próbę.');
                  }
                  window.location.replace(url.href);
                } catch (cause) {
                  setError(`Nie udało się odzyskać danych offline. ${storageError(cause)}`);
                  setBusy(false);
                }
              }}
            >
              Potwierdzam zamknięcie starych kart — przenieś dane
            </button>
          </>
        ) : (
          <>
            <p>
              Na tym urządzeniu pozostały dane ze starszej wersji. Otwórz odzyskiwanie w tym samym profilu i zachowaj
              pamięć aplikacji.
            </p>
            <a href={recoveryUrl.href}>Otwórz odzyskiwanie danych offline</a>
          </>
        )}
      </div>
      {error && (
        <div className="offline-storage-error" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
