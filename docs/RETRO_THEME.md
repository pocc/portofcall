# Retro CRT Theme Implementation

## Overview

Port of Call now features a dual-theme system with a **retro 1980s/90s CRT terminal aesthetic** as the default, and the modern Tailwind design as a fallback option.

**NOTE TO HUMAN:** You can delete either theme system at some point based on your preference. This dual-theme setup is temporary to allow easy comparison.

## Theme Toggle

Users can switch between themes using the toggle button in the top-right corner:
- **RETRO MODE** (default) - Phosphor green CRT terminal aesthetic
- **MODERN MODE** - Clean Tailwind CSS design

The selected theme is persisted in localStorage.

## Retro Theme Features

### Visual Style
- **Colors:**
  - Background: Pitch black (`#000000`)
  - Primary text: Phosphor green (`#33ff33`)
  - Secondary text: Amber (`#ffb000`)
  - Borders: Bright green (`#00ff00`)
  - Glow effect: Semi-transparent green

### CRT Effects
1. **Scanline Overlay** - Repeating horizontal lines for authentic CRT look
2. **Screen Glow** - Subtle inner shadow and box-shadow effects
3. **Text Glow** - Green glow/bloom effect on all text
4. **Flicker Animation** - Subtle opacity variation

### Typography
- **Font:** Monospace (Courier New, VT323)
- **All text** forced to monospace in retro mode
- **ASCII Art Borders** - Double-line box drawing characters (╔═╗ ║ ╚═╝)
- **Typewriter Effect** - Animated text reveal with blinking cursor

### UI Components

#### Buttons
- Blocky design with double borders
- Uppercase text with letter-spacing
- Green glow on hover
- Inset shadow on active state
- Disabled state with reduced opacity

#### Input Fields
- Black background with green border
- Inset green glow
- Focused state with enhanced glow

#### Terminal Output
- Scrollable code/log viewer
- Custom scrollbar styling (green thumb on black track)
- Monospace font with proper line height

#### Cards
- Double-line borders
- Dark semi-transparent background
- Hover effects with glow and scale transform

### Special Components

#### Hex Viewer (`src/components/HexViewer.tsx`)
Classic packet sniffer style with three columns:
- **Offset** (amber) - 8-digit hex address
- **Hex Bytes** (green) - Space-separated hex values
- **ASCII** (dimmed green) - Printable character representation

#### Theme Toggle Button
- Fixed position top-right
- Shows current/next theme
- Phosphor green styling in retro mode

## Files Created

### Core Theme System
- `src/contexts/ThemeContext.tsx` - React context for theme state
- `src/styles/retro.css` - All retro CRT styling
- `src/components/ThemeToggle.tsx` - Theme switcher button
- `src/components/HexViewer.tsx` - Binary data viewer

### Modified Files
- `src/main.tsx` - Wrapped App with ThemeProvider
- `src/App.tsx` - Added theme-aware root classes
- `src/components/ProtocolSelector.tsx` - Retro ASCII art header

## CSS Classes Reference

### Retro-Specific Classes

```css
.retro-screen        /* Main container with CRT effects */
.retro-flicker       /* Subtle screen flicker */
.retro-text          /* Green phosphor text with glow */
.retro-text-amber    /* Amber text variant */
.retro-typewriter    /* Animated typewriter effect */
.retro-box           /* Double-line bordered container */
.retro-button        /* Blocky CRT-style button */
.retro-input         /* Terminal-style input field */
.retro-terminal      /* Scrollable code/log viewer */
.retro-card          /* Protocol card with hover effects */
.retro-grid          /* Grid layout for protocol cards */
.retro-loading       /* Blinking loading indicator */
.retro-boot          /* Boot sequence animation */

/* Status indicators */
.retro-status-idle
.retro-status-connecting
.retro-status-active

/* Hex Viewer */
.retro-hex-viewer
.retro-hex-offset
.retro-hex-bytes
.retro-hex-ascii
```

## Theme Detection

Components can detect the active theme using the `useTheme` hook:

```typescript
import { useTheme } from '../contexts/ThemeContext';

function MyComponent() {
  const { theme, toggleTheme } = useTheme();
  const isRetro = theme === 'retro';

  return (
    <div className={isRetro ? 'retro-terminal' : 'modern-container'}>
      {isRetro ? '> RETRO MODE' : 'Modern Mode'}
    </div>
  );
}
```

## Modern Theme Overrides

When `data-theme="retro"` is set on `<html>`, all Tailwind colors are overridden:
- `bg-slate-*` → Dark green tinted black
- `border-slate-*` → Bright green
- `text-slate-*`, `text-white` → Phosphor green with glow
- `text-blue-*`, `text-green-*`, `text-yellow-*` → Amber

This ensures existing components automatically adapt to retro mode without code changes.

## Animations

### Boot Sequence
```css
@keyframes boot-sequence {
  0% { opacity: 0; filter: blur(10px); }
  20% { opacity: 0.3; }
  50% { opacity: 0.7; filter: blur(5px); }
  100% { opacity: 1; filter: blur(0); }
}
```

### Typewriter
```css
@keyframes typing {
  from { width: 0; }
  to { width: 100%; }
}
```

### Blink (for cursors/loading)
```css
@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

## Performance Notes

- Scanline effect uses CSS gradients (GPU accelerated)
- Glow effects use CSS text-shadow (performant)
- Animations use transform/opacity (GPU accelerated)
- No JavaScript animation loops
- Theme preference cached in localStorage

## Browser Compatibility

Tested and working in:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

CSS features used:
- CSS Custom Properties (var())
- CSS Grid
- CSS Animations
- CSS backdrop-filter (scanlines)
- CSS text-shadow (glow)

## Future Enhancements

Potential additions:
- Sound effects (keyboard clicks, connection beeps)
- Multiple color schemes (amber, white phosphor, Apple IIe green)
- Adjustable scanline intensity
- VT100/VT220 character sets
- ANSI color codes in terminal output
- Blinking cursor in input fields
- Screen curvature effect (CSS filter)
