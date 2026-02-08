# Cross-Platform Compatibility Guide

This document outlines the measures taken to ensure Port of Call works consistently across Windows, macOS, and Linux.

## Line Endings

**Issue**: Different operating systems use different line endings:
- Windows: CRLF (`\r\n`)
- macOS/Linux: LF (`\n`)

**Solution**: `.gitattributes` file normalizes line endings:
- All text files use LF in the repository
- Git auto-converts to the appropriate format on checkout
- Prevents "phantom changes" in diffs due to line ending differences

## Code Style Consistency

**Issue**: Different editors and IDEs have different default settings for indentation, character encoding, and line endings.

**Solution**: `.editorconfig` file ensures consistent formatting:
- UTF-8 encoding
- LF line endings
- 2-space indentation
- Trailing whitespace trimming
- Final newline insertion

Supported by VSCode, IntelliJ, Sublime Text, Vim, Emacs, and most modern editors.

## Node.js Version

**Issue**: Different Node.js versions can cause unexpected behavior and dependency issues.

**Solution**: Multiple version enforcement mechanisms:
- `.nvmrc` file specifies Node.js 22 (for nvm users)
- `package.json` `engines` field requires Node.js ≥18.0.0
- CI/CD environments should respect these version constraints

## ESM Module Compatibility

**Issue**: `__dirname` is not available in ES modules, causing errors on some platforms.

**Solution**: `vite.config.ts` uses `import.meta.url` with `fileURLToPath`:
```typescript
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

This works consistently across all platforms in ESM mode.

## Path Handling

**Issue**: Windows uses backslashes (`\`), Unix uses forward slashes (`/`).

**Solutions implemented**:
- Always use forward slashes in imports (works on all platforms)
- Use `path.join()` and `path.resolve()` for dynamic paths
- Vite and Node.js handle path normalization automatically

## Build Scripts

**Issue**: Some shell commands work differently across platforms.

**Current status**:
- `npm run build`: `tsc && vite build` - Works on all platforms
- `npm run dev`: `vite` - Cross-platform
- `npm run worker:dev`: `wrangler dev` - Cross-platform
- `npm run worker:deploy`: `wrangler deploy` - Cross-platform

The `&&` operator works in:
- Bash (macOS/Linux)
- PowerShell (Windows)
- Modern Windows Command Prompt
- npm's built-in shell

## File Permissions

**Issue**: Unix-like systems use chmod, Windows uses different permission model.

**Solution**: No file permission dependencies in the project. All operations use Node.js APIs that abstract platform differences.

## Testing Checklist

When testing on a new platform:

- [ ] Clone fresh repository
- [ ] Run `npm install`
- [ ] Run `npm run type-check` (should pass)
- [ ] Run `npm run build` (should succeed)
- [ ] Run `npm run dev` (should start dev server)
- [ ] Check that hot reload works
- [ ] Run `npm run preview` (should serve built files)
- [ ] Verify no line ending issues in git status
- [ ] Verify all imports resolve correctly

## Known Platform-Specific Notes

### Windows
- Git for Windows includes Git Bash (recommended terminal)
- PowerShell works for all npm scripts
- WSL2 provides full Linux compatibility if needed

### macOS
- No special considerations
- Use nvm or Homebrew to manage Node.js versions

### Linux
- No special considerations
- Use nvm, n, or system package manager for Node.js

## CI/CD Considerations

When setting up CI/CD pipelines:
- Use `actions/setup-node` with node-version: '22' (GitHub Actions)
- Set `NODE_ENV=production` for production builds
- Use consistent npm version (npm ≥9.0.0)
- Cache `node_modules` for faster builds
- Run `npm ci` instead of `npm install` for reproducible builds

## Additional Resources

- [EditorConfig](https://editorconfig.org/)
- [Git Attributes](https://git-scm.com/docs/gitattributes)
- [Node.js Engine Support](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#engines)
- [Vite Path Handling](https://vitejs.dev/guide/api-javascript.html)
