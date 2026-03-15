import { useChatStore } from '../../stores/chatStore';

export function ServerStatusBanner() {
  const serverArchived = useChatStore((s) => s.serverArchived);
  const serverLockedDown = useChatStore((s) => s.serverLockedDown);

  if (!serverArchived && !serverLockedDown) return null;

  return (
    <div className='flex flex-col'>
      {serverLockedDown && (
        <div className='bg-danger/15 border-b border-danger/30 px-4 py-1.5 text-center text-danger text-xs font-medium'>
          Server is in lockdown mode — only administrators may access
        </div>
      )}
      {serverArchived && (
        <div className='bg-warning/15 border-b border-warning/30 px-4 py-1.5 text-center text-warning text-xs font-medium'>
          Server is archived — messaging and channel creation are disabled
        </div>
      )}
    </div>
  );
}
