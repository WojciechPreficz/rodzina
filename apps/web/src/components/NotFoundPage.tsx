import { Button, Center, Loader, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { useMe } from '../auth.js';
import { labels } from '../i18n/pl.js';
import { AppShell } from './AppShell.js';
import { AuthLayout } from './AuthLayout.js';
import home from '../assets/not-found-home.svg';
import './notFound.css';

export function NotFoundLayout() {
  const { user, isLoading } = useMe();
  if (isLoading)
    return (
      <Center mih="50dvh">
        <Loader aria-label={labels.notFound.loading} />
      </Center>
    );
  return user ? <AppShell /> : <AuthLayout />;
}

export function NotFoundPage() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <div className="not-found-art" aria-hidden="true">
        <span className="not-found-code">404</span>
        <img src={home} alt="" width={400} height={220} />
      </div>
      <Text className="not-found-eyebrow" c="dimmed">
        {labels.notFound.eyebrow}
      </Text>
      <Title id="not-found-title" order={1} className="not-found-title">
        {labels.notFound.titleFirst}
        <br />
        {labels.notFound.titleLast}
      </Title>
      <Text className="not-found-description" c="dimmed">
        {labels.notFound.description}
      </Text>
      <Button
        component={Link}
        to="/kalendarz"
        className="not-found-return"
        leftSection={
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M4 5h16v16H4zM8 2v6m8-6v6M4 10h16" />
          </svg>
        }
      >
        {labels.notFound.back}
      </Button>
      <Text size="sm" c="dimmed" className="not-found-foot">
        {labels.notFound.foot}
      </Text>
    </section>
  );
}
