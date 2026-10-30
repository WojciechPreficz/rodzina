import { useEffect, useRef } from 'react';
import { addNavigationGuard, confirmDiscard } from './nativeNavigation.js';

export function useFormNavigation(additionalChanges?: { isDirty: () => boolean; discard: () => void }) {
  const dirty = useRef(false);
  const additional = useRef(additionalChanges);
  additional.current = additionalChanges;
  useEffect(() => {
    const allow = () => {
      if (!dirty.current && !additional.current?.isDirty()) return true;
      if (!confirmDiscard()) return false;
      dirty.current = false;
      additional.current?.discard();
      return true;
    };
    const remove = addNavigationGuard(allow);
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]') && !allow()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const close = (event: BeforeUnloadEvent) => {
      if (dirty.current || additional.current?.isDirty()) event.preventDefault();
    };
    document.addEventListener('click', click, true);
    window.addEventListener('beforeunload', close);
    return () => {
      remove();
      document.removeEventListener('click', click, true);
      window.removeEventListener('beforeunload', close);
    };
  }, []);
  return {
    changed: () => {
      dirty.current = true;
    },
    saved: () => {
      dirty.current = false;
    },
  };
}
