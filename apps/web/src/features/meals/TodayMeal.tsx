import { useEffect, useState } from 'react';
import { Alert, Anchor, Button, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { useMe } from '../../sessionContext.js';
import { useOffline } from '../../connectivity.js';
import { todayInTimezone } from '../calendar/toScheduleX.js';
import { mealWeekStart } from './mealDates.js';
import { useMealWeek } from './mealQueries.js';

export function TodayMeal() {
  const { family } = useMe();
  const offline = useOffline();
  const timezone = family?.timezone ?? 'Europe/Warsaw';
  const [today, setToday] = useState(() => todayInTimezone(timezone));
  useEffect(() => {
    const update = () => setToday(todayInTimezone(timezone));
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [timezone]);
  const query = useMealWeek(mealWeekStart(today));
  const meal = query.data?.days.find((day) => day.date === today)?.meals[0];
  return (
    <Paper component="section" aria-label="Dziś na obiad" withBorder p="lg" radius="lg" style={{ minWidth: 0 }}>
      <Stack gap="xs">
        <Title order={2} size="h4">
          Dziś na obiad
        </Title>
        {offline && (
          <Text size="sm" c="dimmed">
            Zapisany plan offline. Oczekujące zmiany: {query.status.pendingCount}.
          </Text>
        )}
        {!query.data && offline ? (
          <Text size="sm">Dzisiejszy plan nie został pobrany. Połącz się z internetem.</Text>
        ) : !query.data && query.isError ? (
          <Alert color="red" role="alert">
            Nie udało się pobrać dzisiejszego obiadu.
            <Button variant="subtle" onClick={() => void query.refetch()}>
              Spróbuj ponownie
            </Button>
          </Alert>
        ) : query.isPending ? (
          <Loader size="sm" aria-label="Ładowanie dzisiejszego obiadu" />
        ) : meal ? (
          <>
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
              {meal.title}
            </Text>
            {meal.notes && (
              <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {meal.notes}
              </Text>
            )}
          </>
        ) : (
          <Text size="sm" c="dimmed">
            Brak zaplanowanego obiadu na dziś.
          </Text>
        )}
        <Anchor component={Link} to="/obiady" size="sm">
          Przejdź do planu obiadów
        </Anchor>
      </Stack>
    </Paper>
  );
}
