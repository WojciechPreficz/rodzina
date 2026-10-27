import { Alert, Text } from '@mantine/core';
import type { ReactNode } from 'react';

// Modules supply their own restrictions; connection and data age use one layout.
export function OfflineNotice({
  offline,
  syncedAt,
  issue,
  children,
  role = 'status',
}: {
  offline: boolean;
  syncedAt?: number | null | undefined;
  issue?: string | undefined;
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <>
      {offline && (
        <Alert color="yellow" role={role} title="Tryb offline">
          {children}
          {syncedAt != null && syncedAt > 0 ? (
            <Text size="sm">Ostatnie udane pobranie: {new Date(syncedAt).toLocaleString('pl-PL')}</Text>
          ) : (
            <Text size="sm">Brak potwierdzonego czasu pobrania danych.</Text>
          )}
        </Alert>
      )}
      {issue && <Alert color="red">{issue}</Alert>}
    </>
  );
}
