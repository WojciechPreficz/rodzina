export function shiftMealDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function mealWeekStart(date: string) {
  return shiftMealDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}

export function mealDateLabel(date: string, weekday = false) {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(weekday ? { weekday: 'long' as const } : {}),
  }).format(new Date(`${date}T12:00:00Z`));
}
