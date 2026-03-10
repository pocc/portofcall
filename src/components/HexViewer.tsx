/**
 * Hex Viewer Component - Classic Packet Sniffer Style
 *
 * Displays binary data in hex and ASCII side-by-side (retro terminal style)
 */

interface HexViewerProps {
  data: Uint8Array | string;
  maxBytes?: number;
}

export default function HexViewer({ data, maxBytes = 256 }: HexViewerProps) {
  // Convert string to Uint8Array if needed
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;

  // Limit bytes displayed
  const displayBytes = bytes.slice(0, maxBytes);

  // Convert byte to hex string
  const toHex = (byte: number): string => {
    return byte.toString(16).padStart(2, '0').toUpperCase();
  };

  // Convert byte to ASCII (printable characters only)
  const toAscii = (byte: number): string => {
    return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
  };

  // Group bytes into rows of 16
  const rows: Uint8Array[] = [];
  for (let i = 0; i < displayBytes.length; i += 16) {
    rows.push(displayBytes.slice(i, i + 16));
  }

  if (displayBytes.length === 0) {
    return (
      <div className="bg-slate-800 border border-slate-600 rounded p-4">
        <p className="text-slate-400">
          No data to display
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-600 rounded p-4">
      <div className="font-mono text-xs">
        {rows.map((row, rowIndex) => {
          const offset = rowIndex * 16;
          const hexBytes = Array.from(row).map(toHex).join(' ');
          const ascii = Array.from(row).map(toAscii).join('');

          return (
            <div key={rowIndex} className="grid grid-cols-[auto_1fr_auto] gap-4 mb-1">
              <span className="text-slate-500">
                {offset.toString(16).padStart(8, '0').toUpperCase()}
              </span>
              <span className="text-green-400">
                {hexBytes.padEnd(47, ' ')}
              </span>
              <span className="text-slate-400">
                {ascii}
              </span>
            </div>
          );
        })}
      </div>

      {displayBytes.length < bytes.length && (
        <div className={`mt-4 pt-4 border-t border-slate-600`}>
          <p className="text-slate-400 text-xs">
            Showing {displayBytes.length} of {bytes.length} bytes
          </p>
        </div>
      )}
    </div>
  );
}
