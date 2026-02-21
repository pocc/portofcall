import { useState, useRef, useCallback, useEffect } from 'react';

interface UseApiRequestOptions {
  timeoutMs?: number;
}

interface UseApiRequestReturn<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  execute: (url: string, options?: RequestInit) => Promise<T | null>;
  cancel: () => void;
}

/**
 * Shared hook for API requests with AbortController cleanup and timeout.
 *
 * Features:
 * - Automatic abort on unmount (prevents state-update-after-unmount)
 * - Cancel button support via `cancel()`
 * - Configurable timeout (default: 30s)
 * - Loading/error/data state management
 *
 * Usage:
 *   const { data, error, loading, execute, cancel } = useApiRequest<MyResponse>();
 *   const handleSubmit = () => execute('/api/redis/command', { method: 'POST', body: ... });
 */
export function useApiRequest<T = unknown>(options: UseApiRequestOptions = {}): UseApiRequestReturn<T> {
  const { timeoutMs = 30000 } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Abort on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  }, []);

  const execute = useCallback(async (url: string, fetchOptions?: RequestInit): Promise<T | null> => {
    // Abort any in-flight request and its timeout
    controllerRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const controller = new AbortController();
    controllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    timeoutRef.current = timeoutId;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      const result = await response.json() as T;

      if (!controller.signal.aborted) {
        if (!response.ok) {
          const msg = (result as Record<string, unknown>)?.error;
          setError(typeof msg === 'string' ? msg : `Request failed (${response.status})`);
          return null;
        }
        setData(result);
        return result;
      }
      return null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Distinguish timeout-triggered abort from user-initiated cancel
        if (controller.signal.aborted) {
          setError('Request timed out — the server did not respond in time');
        }
      } else if (!controller.signal.aborted) {
        if (err instanceof TypeError && err.message.includes('fetch')) {
          setError('Network error — check that the host is reachable');
        } else {
          setError(err instanceof Error ? err.message : 'Connection failed');
        }
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
      timeoutRef.current = null;
      setLoading(false);
    }
  }, [timeoutMs]);

  return { data, error, loading, execute, cancel };
}
