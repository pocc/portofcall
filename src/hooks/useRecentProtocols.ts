import { useState, useCallback } from 'react';

const STORAGE_KEY = 'portofcall-recent';
const MAX_RECENT = 10;

export function useRecentProtocols() {
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const addRecent = useCallback((protocolId: string) => {
    setRecent(prev => {
      const next = [protocolId, ...prev.filter(id => id !== protocolId)].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recent, addRecent };
}
