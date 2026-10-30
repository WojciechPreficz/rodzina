import { fireEvent, render, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFormNavigation } from './useFormNavigation.js';
import { allowNavigation } from './nativeNavigation.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('retains an edited form after rejected Back and allows leaving after save', () => {
  let saved!: () => void;
  function Form() {
    const nav = useFormNavigation();
    saved = nav.saved;
    return (
      <form onChangeCapture={nav.changed}>
        <input aria-label="title" />
      </form>
    );
  }
  const result = render(<Form />);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.change(result.getByLabelText('title'), { target: { value: 'Basen' } });
  expect(allowNavigation()).toBe(false);
  expect(confirm).toHaveBeenCalledOnce();
  expect((result.getByLabelText('title') as HTMLInputElement).value).toBe('Basen');
  saved();
  expect(allowNavigation()).toBe(true);
  expect(confirm).toHaveBeenCalledOnce();
});

it('preserves an additional draft after saving the parent and discards it once for repeated navigation checks', () => {
  let draft = true;
  let saved!: () => void;
  function Form() {
    const nav = useFormNavigation({
      isDirty: () => draft,
      discard: () => {
        draft = false;
      },
    });
    saved = nav.saved;
    return null;
  }
  render(<Form />);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  saved();
  expect(allowNavigation()).toBe(false);
  expect(draft).toBe(true);
  confirm.mockReturnValue(true);
  expect(allowNavigation()).toBe(true);
  expect(draft).toBe(false);
  expect(allowNavigation()).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(2);
});
