import { useCallback, useState } from 'react';
import { useSandboxStore } from '../../stores/sandboxStore';
import { useResizableSplitPane } from '../../hooks/useResizableSplitPane';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { SandboxTerminal } from './SandboxTerminal';
import { SandboxFileTree } from './SandboxFileTree';
import { SandboxEditorTabs } from './SandboxEditorTabs';
import { SandboxCodeEditor } from './SandboxCodeEditor';

export function SandboxIDE() {
  const ideVisible = useSandboxStore((s) => s.ideVisible);
  const [fileTreeKey, setFileTreeKey] = useState(0);

  const {
    topPercent,
    isResizing: isVResizing,
    handleMouseDown: handleVResize,
    containerRef,
  } = useResizableSplitPane({
    defaultTopPercent: 55,
    minTopPercent: 20,
    maxTopPercent: 80,
    storageKey: 'sandbox-ide-split',
  });

  const {
    width: treeWidth,
    isResizing: isHResizing,
    handleMouseDown: handleHResize,
  } = useResizablePanel({
    defaultWidth: 200,
    minWidth: 120,
    maxWidth: 400,
    side: 'left',
    storageKey: 'sandbox-file-tree-width',
  });

  const handleFileSaved = useCallback(() => {
    setFileTreeKey((k) => k + 1);
  }, []);

  if (!ideVisible) {
    return (
      <div className='h-full bg-[#1a1a2e]'>
        <SandboxTerminal />
      </div>
    );
  }

  return (
    <div ref={containerRef} className='flex flex-col h-full'>
      {/* IDE pane (top) */}
      <div
        style={{ height: `${topPercent}%` }}
        className='flex overflow-hidden flex-shrink-0'
      >
        {/* File tree */}
        <div
          style={{ width: treeWidth }}
          className='flex-shrink-0 overflow-hidden border-r border-default-200'
        >
          <SandboxFileTree key={fileTreeKey} />
        </div>

        {/* Tree resize handle */}
        <div
          className={`w-[4px] cursor-col-resize flex-shrink-0 transition-colors ${
            isHResizing ? 'bg-primary' : 'hover:bg-primary/30'
          }`}
          onMouseDown={handleHResize}
        />

        {/* Editor area */}
        <div className='flex-1 flex flex-col overflow-hidden bg-[#1a1a2e]'>
          <SandboxEditorTabs />
          <div className='flex-1 overflow-hidden'>
            <SandboxCodeEditor onSaved={handleFileSaved} />
          </div>
        </div>
      </div>

      {/* Horizontal resize handle */}
      <div
        className={`h-[6px] cursor-row-resize flex-shrink-0 transition-colors ${
          isVResizing ? 'bg-primary' : 'hover:bg-primary/30'
        }`}
        onMouseDown={handleVResize}
      />

      {/* Terminal pane (bottom) */}
      <div className='flex-1 overflow-hidden bg-[#1a1a2e]'>
        <SandboxTerminal />
      </div>
    </div>
  );
}
