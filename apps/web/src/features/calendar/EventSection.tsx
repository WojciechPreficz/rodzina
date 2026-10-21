import { Paper, Stack, Title } from '@mantine/core';
import type { ReactNode } from 'react';

export function EventSection({ title, number, children }: { title: string; number?: string; children: ReactNode }) {
  return (
    <Paper component="section" aria-label={title} withBorder className="event-section" p="lg">
      <Stack gap="md">
        <Title order={2} size="sm" className="event-section-title">
          {number && <span aria-hidden="true">{number}</span>}
          {title}
        </Title>
        {children}
      </Stack>
    </Paper>
  );
}
