import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { Tooltip } from '@heroui/react';
import { useSandboxStore } from '../../stores/sandboxStore';

export function SandboxEditorTabs() {
  const openFiles = useSandboxStore((s) => s.openFiles);
  const activeFilePath = useSandboxStore((s) => s.activeFilePath);
  const setActiveFile = useSandboxStore((s) => s.setActiveFile);
  const closeFile = useSandboxStore((s) => s.closeFile);

  if (openFiles.length === 0) return null;

  return (
    <div className='flex items-center bg-[#1e1e2e] border-b border-default-200 overflow-x-auto flex-shrink-0'>
      {openFiles.map((file) => {
        const isActive = file.path === activeFilePath;
        const isDirty = file.content !== file.savedContent;
        const fileName = file.path.split('/').pop() || file.path;

        return (
          <Tooltip key={file.path} content={file.path} delay={500}>
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-default-200 whitespace-nowrap cursor-pointer transition-colors ${
                isActive
                  ? 'bg-[#1a1a2e] text-foreground'
                  : 'text-default-400 hover:text-default-300 hover:bg-[#252540]'
              }`}
              onClick={() => setActiveFile(file.path)}
              onAuxClick={(e) => {
                if (e.button === 1) closeFile(file.path);
              }}
            >
              <span>
                {isDirty && <span className='text-warning mr-0.5'>*</span>}
                {fileName}
              </span>
              <span
                className='hover:text-danger ml-1 opacity-60 hover:opacity-100'
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.path);
                }}
              >
                <FontAwesomeIcon icon={faXmark} className='text-[10px]' />
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
