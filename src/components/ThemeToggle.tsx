import { useTheme } from '../contexts/ThemeContext';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="theme-toggle-bar">
      <button
        onClick={toggleTheme}
        className="theme-toggle"
        aria-label={`Switch to ${theme === 'retro' ? 'modern' : 'retro'} theme`}
      >
        {theme === 'retro' ? (
          <>
            <span className="retro-text-amber">[ </span>
            <span className="retro-text">RETRO MODE</span>
            <span className="retro-text-amber"> ]</span>
            <span className="theme-toggle-arrow"> ──► </span>
            <span className="theme-toggle-inactive">SWITCH TO MODERN</span>
          </>
        ) : (
          <>
            <span className="theme-toggle-inactive">SWITCH TO RETRO</span>
            <span className="theme-toggle-arrow"> ◄── </span>
            <span className="theme-toggle-active">MODERN MODE</span>
          </>
        )}
      </button>
    </div>
  );
}
