import { fireEvent } from '@testing-library/react';
import { Temporal } from 'temporal-polyfill';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendarSwipePlugin } from './calendarSwipe.js';

afterEach(() => vi.useRealTimers());

function setup(small = true, units = 7) {
  const element = document.createElement('div');
  const event = document.createElement('button');
  element.append(event);
  const date = { value: Temporal.PlainDate.from('2026-10-20') };
  const plugin = createCalendarSwipePlugin();
  plugin.onRender?.({
    elements: { calendarWrapper: element },
    calendarState: { isCalendarSmall: { value: small }, view: { value: 'week-agenda' } },
    datePickerState: { selectedDate: date },
    config: {
      views: {
        value: [
          {
            name: 'week-agenda',
            backwardForwardUnits: units,
            backwardForwardFn: (date: Temporal.PlainDate, days: number) => date.add({ days }),
          },
        ],
      },
    },
  });
  const start = (x = 200, y = 200) => fireEvent.touchStart(event, { touches: [{ clientX: x, clientY: y }] });
  const move = (x: number, y = 200) => fireEvent.touchMove(event, { touches: [{ clientX: x, clientY: y }] });
  const end = (x: number, y = 200) =>
    fireEvent.touchEnd(event, { touches: [], changedTouches: [{ clientX: x, clientY: y }] });
  return { element, event, date, plugin, start, move, end };
}

describe('calendar touch navigation', () => {
  it('moves one period in either direction and suppresses the event click after a swipe', () => {
    const calendar = setup();
    const click = vi.fn();
    calendar.event.addEventListener('click', click);
    calendar.start();
    expect(calendar.move(100)).toBe(false);
    calendar.end(100);
    expect(calendar.date.value.toString()).toBe('2026-10-27');
    fireEvent.click(calendar.event);
    expect(click).not.toHaveBeenCalled();
    calendar.start(100);
    calendar.move(200);
    calendar.end(200);
    expect(calendar.date.value.toString()).toBe('2026-10-20');
  });

  it('preserves taps, small movements and vertical scrolling, even if the gesture later turns sideways', () => {
    const calendar = setup();
    const click = vi.fn();
    calendar.event.addEventListener('click', click);
    calendar.start();
    calendar.end(200);
    fireEvent.click(calendar.event);
    expect(click).toHaveBeenCalledOnce();
    calendar.start();
    calendar.move(180);
    calendar.end(180);
    calendar.start();
    expect(calendar.move(200, 240)).toBe(true);
    calendar.move(80, 240);
    calendar.end(80, 240);
    expect(calendar.date.value.toString()).toBe('2026-10-20');
  });

  it('ignores multi-touch, canceled gestures and long presses', () => {
    vi.useFakeTimers();
    const calendar = setup();
    calendar.start();
    fireEvent.touchMove(calendar.event, {
      touches: [
        { clientX: 180, clientY: 200 },
        { clientX: 220, clientY: 200 },
      ],
    });
    calendar.end(80);
    calendar.start();
    fireEvent.touchCancel(calendar.event);
    calendar.end(80);
    calendar.start();
    vi.advanceTimersByTime(1000);
    calendar.end(80);
    expect(calendar.date.value.toString()).toBe('2026-10-20');
  });

  it('ignores desktop gestures, calendar header interactions and destroyed instances', () => {
    const desktop = setup(false);
    desktop.start();
    desktop.end(80);
    expect(desktop.date.value.toString()).toBe('2026-10-20');
    const calendar = setup();
    calendar.event.className = 'sx__calendar-header';
    calendar.start();
    calendar.end(80);
    calendar.event.className = '';
    calendar.plugin.destroy?.();
    calendar.start();
    calendar.end(80);
    expect(calendar.date.value.toString()).toBe('2026-10-20');
  });
});
