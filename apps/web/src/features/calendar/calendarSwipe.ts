import type { CalendarConfig, PluginBase } from '@schedule-x/calendar';

type CalendarApp = Parameters<NonNullable<NonNullable<CalendarConfig['callbacks']>['onRender']>>[0];

export function createCalendarSwipePlugin(): PluginBase<'familySwipe'> {
  let detach: (() => void) | undefined;
  return {
    name: 'familySwipe',
    onRender(app: CalendarApp) {
      detach?.();
      const element = app.elements.calendarWrapper;
      if (!element) return;
      let start: { x: number; y: number; time: number } | undefined;
      let axis: 'horizontal' | 'vertical' | undefined;
      let suppressClickUntil = 0;
      const reset = () => {
        start = undefined;
        axis = undefined;
      };
      const onStart = (event: TouchEvent) => {
        reset();
        suppressClickUntil = 0;
        if (!app.calendarState.isCalendarSmall.value || event.touches.length !== 1) return;
        if (event.target instanceof Element && event.target.closest('.sx__calendar-header, input, select, textarea'))
          return;
        const touch = event.touches[0];
        if (!touch) return;
        start = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      };
      const onMove = (event: TouchEvent) => {
        if (event.touches.length !== 1) return reset();
        if (!start) return;
        const touch = event.touches[0];
        if (!touch) return reset();
        const dx = Math.abs(touch.clientX - start.x);
        const dy = Math.abs(touch.clientY - start.y);
        if (!axis && Math.max(dx, dy) >= 12) axis = dx > dy * 1.5 ? 'horizontal' : 'vertical';
        if (axis === 'horizontal' && event.cancelable) event.preventDefault();
      };
      const onEnd = (event: TouchEvent) => {
        const origin = start;
        const direction = axis;
        reset();
        if (!origin || direction === 'vertical' || event.touches.length || event.changedTouches.length !== 1) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - origin.x;
        const dy = touch.clientY - origin.y;
        if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.5 || Date.now() - origin.time > 800) return;
        if (!app.calendarState.isCalendarSmall.value) return;
        const view = app.config.views.value.find((item) => item.name === app.calendarState.view.value);
        if (!view) return;
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        suppressClickUntil = Date.now() + 400;
        const date = view.backwardForwardFn(
          app.datePickerState.selectedDate.value,
          (dx < 0 ? 1 : -1) * view.backwardForwardUnits,
        );
        app.datePickerState.selectedDate.value = 'toPlainDate' in date ? date.toPlainDate() : date;
      };
      const onClick = (event: MouseEvent) => {
        if (Date.now() >= suppressClickUntil) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      element.addEventListener('touchstart', onStart, { capture: true, passive: true });
      element.addEventListener('touchmove', onMove, { capture: true, passive: false });
      element.addEventListener('touchend', onEnd, { capture: true, passive: false });
      element.addEventListener('touchcancel', reset, true);
      element.addEventListener('click', onClick, true);
      detach = () => {
        element.removeEventListener('touchstart', onStart, true);
        element.removeEventListener('touchmove', onMove, true);
        element.removeEventListener('touchend', onEnd, true);
        element.removeEventListener('touchcancel', reset, true);
        element.removeEventListener('click', onClick, true);
        reset();
      };
    },
    destroy() {
      detach?.();
      detach = undefined;
    },
  };
}
