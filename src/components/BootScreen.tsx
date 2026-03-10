import { useState, useEffect } from 'react';
import { protocols } from '../data/protocols';

export default function BootScreen() {
  const [visible, setVisible] = useState(() => {
    return !sessionStorage.getItem('portofcall-booted');
  });
  const [line, setLine] = useState(0);

  const lines = [
    'PORT OF CALL v1.0',
    'TCP PROTOCOL TESTING SYSTEM',
    '',
    `${protocols.length} PROTOCOLS LOADED`,
    'MEMORY OK... SOCKETS OK...',
    '',
    'READY.',
    '> _',
  ];

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setLine(prev => {
        if (prev >= lines.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            sessionStorage.setItem('portofcall-booted', '1');
            setVisible(false);
          }, 600);
          return prev;
        }
        return prev + 1;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [visible, lines.length]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
      <div className="font-mono text-green-500 text-sm sm:text-base max-w-md px-8">
        {lines.slice(0, line + 1).map((text, i) => (
          <div
            key={i}
            className="leading-relaxed"
            style={{
              textShadow: '0 0 5px rgba(0, 255, 0, 0.5), 0 0 10px rgba(0, 255, 0, 0.3)',
            }}
          >
            {text || '\u00A0'}
          </div>
        ))}
      </div>
      {/* Scanlines */}
      <div
        className="fixed inset-0 pointer-events-none z-[101]"
        style={{
          background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15), rgba(0,0,0,0.15) 1px, transparent 1px, transparent 2px)',
        }}
      />
    </div>
  );
}
