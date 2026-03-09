import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'retro' | 'modern';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('portofcall-theme');
      return saved === 'retro' || saved === 'modern' ? saved : 'retro';
    } catch {
      return 'retro';
    }
  });

  useEffect(() => {
    try { localStorage.setItem('portofcall-theme', theme); } catch { /* quota or private browsing */ }
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'retro' ? 'modern' : 'retro');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
