import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDocumentStatus, type FamilyDocument } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { useOffline } from '../../connectivity.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';

export function useDocumentsQuery() {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  return useQuery({
    queryKey: ['documents', family?.id, user?.id],
    enabled: !!family && !!user && familyConfirmed && !offline,
    queryFn: async ({ signal }) =>
      (await apiFetch<{ documents: FamilyDocument[] }>('/api/documents', { signal })).documents,
    refetchInterval: SYNC_INTERVAL_MS,
  });
}

export function useDocumentDates() {
  const { family } = useMe();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const timezone = family?.timezone ?? 'Europe/Warsaw';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(clock);
  return { timezone, today };
}

export function useDocumentAttentionCount() {
  const query = useDocumentsQuery();
  const { today } = useDocumentDates();
  return (query.data ?? []).filter((item) => getDocumentStatus(item.type, item.expiresOn, today) !== 'valid').length;
}
