import { Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <Title order={1} className="page-header-title">
          {title}
        </Title>
        {description && (
          <Text size="sm" c="dimmed" className="page-header-description">
            {description}
          </Text>
        )}
      </div>
      {actions}
    </header>
  );
}
