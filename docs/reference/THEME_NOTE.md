# Theme System - Decision Needed

## Current Status

Port of Call has **two complete theme systems**:

1. **RETRO CRT Theme** (DEFAULT)
   - 1980s/90s terminal aesthetic
   - Phosphor green/amber colors
   - Scanline effects, text glow
   - ASCII art borders
   - Files: `src/styles/retro.css`, `src/contexts/ThemeContext.tsx`

2. **Modern Tailwind Theme** (FALLBACK)
   - Clean, modern design
   - Slate gray color scheme
   - Smooth gradients
   - Files: `src/App.css` (original Tailwind styles)

## Decision Required

**You need to decide which theme to keep long-term:**

### Option A: Keep Retro Theme Only
**Benefits:**
- Unique, memorable aesthetic
- Stands out from generic modern UIs
- Perfect for "retro protocol" theme
- Nostalgic appeal

**To implement:**
1. Delete `src/contexts/ThemeContext.tsx`
2. Delete `src/components/ThemeToggle.tsx`
3. Remove theme toggle from `src/App.tsx`
4. Remove `useTheme()` calls from components
5. Make retro classes permanent (remove conditional styling)
6. Keep `src/styles/retro.css`, remove modern overrides

### Option B: Keep Modern Theme Only
**Benefits:**
- Clean, professional appearance
- Better accessibility (higher contrast on some elements)
- Familiar to modern users
- Easier to maintain

**To implement:**
1. Delete `src/styles/retro.css`
2. Delete `src/contexts/ThemeContext.tsx`
3. Delete `src/components/ThemeToggle.tsx`
4. Remove theme toggle from `src/App.tsx`
5. Remove `useTheme()` calls from components
6. Revert `ProtocolSelector` header to simple modern version

### Option C: Keep Both (Current State)
**Benefits:**
- Users can choose their preference
- Easy A/B testing
- Showcases both designs

**Drawbacks:**
- Maintenance overhead (two CSS systems)
- Larger bundle size
- Need to test all components in both themes

## Current Implementation

The theme toggle button appears in the top-right corner:
- **[RETRO MODE] → MODERN** (when in retro)
- **RETRO ← MODERN MODE** (when in modern)

Users' preference is saved in `localStorage` and persists across sessions.

## File Sizes

- **Retro CSS**: ~8KB (uncompressed)
- **Theme Context**: ~1KB
- **Theme Toggle Component**: ~500 bytes
- **HexViewer Component**: ~2KB

Total overhead for dual-theme system: ~11.5KB

## Recommendation

For a tool focused on **legacy TCP protocols** (Gopher, Finger, Telnet, etc.), the **RETRO theme is thematically perfect** and gives the project a unique identity.

However, if accessibility and broad appeal are priorities, the **MODERN theme** may be better.

## Action Items

1. Test both themes thoroughly
2. Get user feedback
3. Choose one theme to keep
4. Follow the implementation steps above
5. Delete this file when decision is made

---

**Current Default**: Retro theme is active by default. Toggle to see modern theme.
