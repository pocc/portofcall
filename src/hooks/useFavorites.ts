import { useState, useCallback } from 'react';

const STORAGE_KEY = 'portofcall-favorites';

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const toggleFavorite = useCallback((protocolId: string) => {
    setFavorites(prev => {
      const next = prev.includes(protocolId)
        ? prev.filter(id => id !== protocolId)
        : [...prev, protocolId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback((protocolId: string) => {
    return favorites.includes(protocolId);
  }, [favorites]);

  return { favorites, toggleFavorite, isFavorite };
}
