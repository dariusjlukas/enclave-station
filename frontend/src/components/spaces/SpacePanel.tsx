import { useMemo } from 'react';
import { Button } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faHashtag,
  faLock,
  faMagnifyingGlass,
  faGear,
  faFolderOpen,
  faCalendar,
  faListCheck,
  faBook,
  faPuzzlePiece,
  faHouseUser,
} from '@fortawesome/free-solid-svg-icons';
import { useChatStore } from '../../stores/chatStore';
import { SpaceAvatar } from '../common/SpaceAvatar';

interface Props {
  spaceId: string;
  onCreateChannel: () => void;
  onBrowseChannels: () => void;
  onShowSettings: () => void;
  onSelect?: () => void;
}

export function SpacePanel({
  spaceId,
  onCreateChannel,
  onBrowseChannels,
  onShowSettings,
  onSelect,
}: Props) {
  const allChannels = useChatStore((s) => s.channels);
  const spaces = useChatStore((s) => s.spaces);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const activeToolView = useChatStore((s) => s.activeToolView);
  const setActiveToolView = useChatStore((s) => s.setActiveToolView);
  const user = useChatStore((s) => s.user);
  const mentionCounts = useChatStore((s) => s.mentionCounts);

  const space = spaces.find((s) => s.id === spaceId);
  const channels = useMemo(
    () => allChannels.filter((c) => !c.is_direct && c.space_id === spaceId),
    [allChannels, spaceId],
  );

  const enabledTools = useMemo(
    () => new Set(space?.enabled_tools || []),
    [space?.enabled_tools],
  );

  const canManage =
    space?.my_role === 'admin' ||
    space?.my_role === 'owner' ||
    user?.role === 'admin' ||
    user?.role === 'owner';
  const canCreate = !space?.is_archived && canManage;

  if (!space) {
    return (
      <div className='flex-1 flex items-center justify-center text-default-400 text-sm'>
        Space not found
      </div>
    );
  }

  const isFilesActive =
    activeToolView?.type === 'files' && activeToolView.spaceId === spaceId;
  const isCalendarActive =
    activeToolView?.type === 'calendar' && activeToolView.spaceId === spaceId;
  const isTasksActive =
    activeToolView?.type === 'tasks' && activeToolView.spaceId === spaceId;
  const isWikiActive =
    activeToolView?.type === 'wiki' && activeToolView.spaceId === spaceId;
  const isMinigamesActive =
    activeToolView?.type === 'minigames' && activeToolView.spaceId === spaceId;

  return (
    <div className='flex flex-col h-full'>
      <div className='p-3 border-b border-default-100'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2 min-w-0'>
            {space.is_personal ? (
              <div className='w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0'>
                <FontAwesomeIcon
                  icon={faHouseUser}
                  className='text-[10px] text-primary'
                />
              </div>
            ) : (
              <SpaceAvatar
                name={space.name}
                avatarFileId={space.avatar_file_id}
                profileColor={space.profile_color}
                size='sm'
              />
            )}
            <h3 className='text-sm font-semibold text-foreground truncate'>
              {space.is_personal ? 'My Space' : space.name}
            </h3>
          </div>
          <Button
            isIconOnly
            variant='light'
            size='sm'
            onPress={onShowSettings}
            title='Space Settings'
          >
            <FontAwesomeIcon icon={faGear} className='text-xs' />
          </Button>
        </div>
        {!space.is_personal && space.description && (
          <p className='text-xs text-default-400 mt-1 truncate'>
            {space.description}
          </p>
        )}
        {space.is_archived && (
          <p className='text-xs text-warning mt-1'>Archived — read only</p>
        )}
      </div>

      <div className='flex-1 overflow-y-auto p-2'>
        {/* Channels section — hidden for personal spaces */}
        {!space.is_personal && (
          <div className='mb-4'>
            <div className='flex items-center justify-between px-3 py-2'>
              <h4 className='text-xs font-semibold text-default-500 uppercase tracking-wider'>
                Channels
              </h4>
              <div className='flex gap-0.5'>
                <Button
                  isIconOnly
                  variant='light'
                  size='sm'
                  onPress={onBrowseChannels}
                  title='Browse channels'
                >
                  <FontAwesomeIcon
                    icon={faMagnifyingGlass}
                    className='text-xs'
                  />
                </Button>
                {canCreate && (
                  <Button
                    isIconOnly
                    variant='light'
                    size='sm'
                    onPress={onCreateChannel}
                    title='Create channel'
                  >
                    +
                  </Button>
                )}
              </div>
            </div>
            {channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => {
                  setActiveChannel(ch.id);
                  onSelect?.();
                }}
                className={`w-full text-left px-3 py-2.5 text-sm rounded-md transition-colors flex items-center cursor-pointer ${
                  activeChannelId === ch.id
                    ? 'bg-primary/20 text-primary'
                    : 'text-default-500 hover:bg-content2/50 hover:text-foreground'
                }`}
              >
                <span className='truncate'>
                  <FontAwesomeIcon
                    icon={ch.is_public ? faHashtag : faLock}
                    className='text-xs mr-1.5'
                  />
                  {ch.name}
                </span>
                {ch.is_archived && (
                  <span className='ml-1 text-xs text-default-400'>
                    (archived)
                  </span>
                )}
                {!ch.is_archived && ch.my_role === 'read' && (
                  <span className='ml-1 text-xs text-default-400'>
                    (read-only)
                  </span>
                )}
                {(mentionCounts[ch.id] || 0) > 0 && (
                  <span className='ml-auto flex-shrink-0 min-w-[20px] h-5 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center px-1.5'>
                    @{mentionCounts[ch.id]}
                  </span>
                )}
              </button>
            ))}
            {channels.length === 0 && (
              <p className='text-center text-default-400 text-xs py-4'>
                No channels yet
              </p>
            )}
          </div>
        )}

        {!space.is_personal && (
          <div className='border-t border-default-100 mx-3 my-1' />
        )}

        {/* Tools section */}
        <div className='space-y-1'>
          {/* Files — enabled */}
          {enabledTools.has('files') && (
            <button
              onClick={() => {
                setActiveToolView({ type: 'files', spaceId });
                onSelect?.();
              }}
              className={`w-full text-left flex items-center gap-2 py-2.5 text-sm rounded-md px-3 transition-colors cursor-pointer ${
                isFilesActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-default-500 hover:bg-content2/50 hover:text-foreground'
              }`}
            >
              <FontAwesomeIcon icon={faFolderOpen} className='text-xs w-4' />
              <span>Files</span>
            </button>
          )}

          {/* Calendar — enabled */}
          {enabledTools.has('calendar') && (
            <button
              onClick={() => {
                setActiveToolView({ type: 'calendar', spaceId });
                onSelect?.();
              }}
              className={`w-full text-left flex items-center gap-2 py-2.5 text-sm rounded-md px-3 transition-colors cursor-pointer ${
                isCalendarActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-default-500 hover:bg-content2/50 hover:text-foreground'
              }`}
            >
              <FontAwesomeIcon icon={faCalendar} className='text-xs w-4' />
              <span>Calendar</span>
            </button>
          )}

          {/* Tasks — enabled */}
          {enabledTools.has('tasks') && (
            <button
              onClick={() => {
                setActiveToolView({ type: 'tasks', spaceId });
                onSelect?.();
              }}
              className={`w-full text-left flex items-center gap-2 py-2.5 text-sm rounded-md px-3 transition-colors cursor-pointer ${
                isTasksActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-default-500 hover:bg-content2/50 hover:text-foreground'
              }`}
            >
              <FontAwesomeIcon icon={faListCheck} className='text-xs w-4' />
              <span>Tasks</span>
            </button>
          )}

          {/* Wiki — enabled */}
          {enabledTools.has('wiki') && (
            <button
              onClick={() => {
                if (isWikiActive) {
                  useChatStore.getState().toggleWikiSidebar();
                } else {
                  setActiveToolView({ type: 'wiki', spaceId });
                }
                onSelect?.();
              }}
              className={`w-full text-left flex items-center gap-2 py-2.5 text-sm rounded-md px-3 transition-colors cursor-pointer ${
                isWikiActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-default-500 hover:bg-content2/50 hover:text-foreground'
              }`}
            >
              <FontAwesomeIcon icon={faBook} className='text-xs w-4' />
              <span>Wiki</span>
            </button>
          )}

          {/* Minigames — enabled */}
          {enabledTools.has('minigames') && (
            <button
              onClick={() => {
                if (isMinigamesActive) {
                  // Re-set to force remount and return to game selection
                  setActiveToolView(null);
                  setTimeout(
                    () => setActiveToolView({ type: 'minigames', spaceId }),
                    0,
                  );
                } else {
                  setActiveToolView({ type: 'minigames', spaceId });
                }
                onSelect?.();
              }}
              className={`w-full text-left flex items-center gap-2 py-2.5 text-sm rounded-md px-3 transition-colors cursor-pointer ${
                isMinigamesActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-default-500 hover:bg-content2/50 hover:text-foreground'
              }`}
            >
              <FontAwesomeIcon icon={faPuzzlePiece} className='text-xs w-4' />
              <span>Minigames</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
