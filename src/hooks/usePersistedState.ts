import { useState, useCallback, useEffect } from 'react';

const STORAGE_PREFIX = 'poc-form:';

/**
 * Drop-in replacement for useState<string> that persists to localStorage.
 * Key should be globally unique (e.g. "ssh-host", "mysql-port").
 *
 * On mount, reads the cached value (if any) and uses it instead of defaultValue.
 * On every set, writes the new value to localStorage.
 */
export function usePersistedState(key: string, defaultValue: string): [string, (v: string) => void] {
  const storageKey = STORAGE_PREFIX + key;

  const [value, setValueRaw] = useState<string>(() => {
    try {
      const cached = localStorage.getItem(storageKey);
      return cached !== null ? cached : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  // Sync to localStorage on change
  useEffect(() => {
    try {
      if (value === defaultValue) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, value);
      }
    } catch {
      // Storage full or unavailable — silently ignore
    }
  }, [value, defaultValue, storageKey]);

  const setValue = useCallback((v: string) => {
    setValueRaw(v);
  }, []);

  return [value, setValue];
}
