import { IconRail } from './IconRail';
import { SidePanel } from './SidePanel';
import { useChatStore } from '../../stores/chatStore';

interface Props {
  onCreateConversation: () => void;
  onCreateChannel: () => void;
  onBrowseChannels: () => void;
  onBrowseSpaces: () => void;
  onShowSpaceSettings: () => void;
  open: boolean;
  onClose: () => void;
}

export function NewSidebar({
  onCreateConversation,
  onCreateChannel,
  onBrowseChannels,
  onBrowseSpaces,
  onShowSpaceSettings,
  open,
  onClose,
}: Props) {
  const sidePanelCollapsed = useChatStore((s) => s.sidePanelCollapsed);

  return (
    <>
      {open && (
        <div
          className='fixed inset-0 bg-black/50 z-30 md:hidden'
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 bg-background/95 border-r border-default-100 flex transform transition-all duration-200 ease-in-out md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${sidePanelCollapsed ? 'w-16' : 'w-72'}`}
      >
        <IconRail onBrowseSpaces={onBrowseSpaces} />
        <div
          className={`flex flex-col overflow-hidden transition-all duration-200 ${
            sidePanelCollapsed ? 'w-0 opacity-0' : 'flex-1 opacity-100'
          }`}
        >
          <SidePanel
            onCreateConversation={onCreateConversation}
            onCreateChannel={onCreateChannel}
            onBrowseChannels={onBrowseChannels}
            onShowSpaceSettings={onShowSpaceSettings}
            onSelect={onClose}
          />
        </div>
      </aside>
    </>
  );
}
