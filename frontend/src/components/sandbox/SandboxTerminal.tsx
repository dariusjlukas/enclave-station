import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { v86Manager } from '../../services/v86Manager';

export function SandboxTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: '#3a3a5e',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // Replay buffered output
    const history = v86Manager.getSerialHistory();
    if (history) {
      term.write(history);
    }

    // Connect live output
    v86Manager.attachTerminal((data) => term.write(data));

    // Forward input to VM serial
    const inputDisposable = term.onData((data) => v86Manager.sendInput(data));

    // Auto-resize
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fitAddon.fit());
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      v86Manager.detachTerminal();
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className='h-full w-full'
      style={{ padding: '4px' }}
    />
  );
}
