import { useTheme } from '../contexts/ThemeContext';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle"
      aria-label={`Switch to ${theme === 'retro' ? 'modern' : 'retro'} theme`}
    >
      {theme === 'retro' ? (
        <>
          <span className="retro-text-amber">[</span>
          <span className="retro-text">RETRO MODE</span>
          <span className="retro-text-amber">]</span>
          {' → '}
          <span style={{ opacity: 0.5 }}>MODERN</span>
        </>
      ) : (
        <>
          <span style={{ opacity: 0.5 }}>RETRO</span>
          {' ← '}
          <span>MODERN MODE</span>
        </>
      )}
    </button>
  );
}
