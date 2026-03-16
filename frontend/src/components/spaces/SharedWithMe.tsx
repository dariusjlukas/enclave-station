import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Spinner,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolderOpen,
  faCalendar,
  faListCheck,
  faBook,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useChatStore } from '../../stores/chatStore';
import { getSharedWithMe } from '../../services/api';
import type {
  SharedResource,
  SharedWithMe as SharedWithMeType,
} from '../../types';

interface Section {
  key: keyof SharedWithMeType;
  label: string;
  icon: IconDefinition;
  toolType: 'files' | 'calendar' | 'tasks' | 'wiki';
}

const sections: Section[] = [
  { key: 'files', label: 'Files', icon: faFolderOpen, toolType: 'files' },
  { key: 'wiki_pages', label: 'Wiki Pages', icon: faBook, toolType: 'wiki' },
  {
    key: 'calendar_events',
    label: 'Calendar',
    icon: faCalendar,
    toolType: 'calendar',
  },
  { key: 'task_boards', label: 'Tasks', icon: faListCheck, toolType: 'tasks' },
];

interface Props {
  onClose: () => void;
}

export function SharedWithMe({ onClose }: Props) {
  const setActiveToolView = useChatStore((s) => s.setActiveToolView);
  const [data, setData] = useState<SharedWithMeType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'name' | 'owner'>('name');

  const filteredData = useMemo(() => {
    if (!data) return null;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return data;
    const filter = (items: SharedResource[]) =>
      items.filter((item) =>
        searchMode === 'name'
          ? item.name.toLowerCase().includes(q)
          : item.owner_username.toLowerCase().includes(q),
      );
    return {
      files: filter(data.files),
      wiki_pages: filter(data.wiki_pages),
      calendar_events: filter(data.calendar_events),
      task_boards: filter(data.task_boards),
    };
  }, [data, searchQuery, searchMode]);

  useEffect(() => {
    let cancelled = false;

    getSharedWithMe()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err?.message ?? 'Failed to load shared resources');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isEmpty =
    data &&
    data.files.length === 0 &&
    data.wiki_pages.length === 0 &&
    data.calendar_events.length === 0 &&
    data.task_boards.length === 0;

  const filteredEmpty =
    filteredData &&
    filteredData.files.length === 0 &&
    filteredData.wiki_pages.length === 0 &&
    filteredData.calendar_events.length === 0 &&
    filteredData.task_boards.length === 0;

  const renderContent = () => {
    if (loading) {
      return (
        <div className='flex items-center justify-center py-12'>
          <Spinner size='lg' />
        </div>
      );
    }
    if (error) {
      return (
        <div className='text-danger text-sm text-center py-8'>{error}</div>
      );
    }
    if (!data || isEmpty) {
      return (
        <div className='text-default-400 text-sm text-center py-8'>
          Nothing shared with you yet
        </div>
      );
    }
    return (
      <div className='space-y-2'>
        {/* Search bar */}
        <div className='flex gap-2 items-center'>
          <input
            type='text'
            placeholder={
              searchMode === 'name'
                ? 'Search by item name...'
                : 'Search by owner username...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='flex-1 px-3 py-1.5 rounded-lg bg-content2 border border-divider text-sm outline-none focus:border-primary'
          />
          <select
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as 'name' | 'owner')}
            className='px-2 py-1.5 rounded-lg bg-content2 border border-divider text-xs'
          >
            <option value='name'>Name</option>
            <option value='owner'>Owner</option>
          </select>
        </div>

        {filteredEmpty && (
          <div className='text-default-400 text-sm text-center py-6'>
            No results found
          </div>
        )}

        {sections.map((section) => {
          const items = filteredData![section.key];
          if (items.length === 0) return null;

          const isExpanded = !!expanded[section.key];

          return (
            <div key={section.key} className='mb-1'>
              <button
                type='button'
                onClick={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [section.key]: !prev[section.key],
                  }))
                }
                className='w-full flex items-center gap-2 px-1 py-2 cursor-pointer hover:bg-content2/30 rounded-md transition-colors'
              >
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`text-[10px] text-default-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
                <FontAwesomeIcon
                  icon={section.icon}
                  className='text-xs text-default-500 w-4'
                />
                <h4 className='text-xs font-semibold text-default-500 uppercase tracking-wider'>
                  {section.label}
                </h4>
                <span className='text-xs text-default-400 ml-auto'>
                  {items.length}
                </span>
              </button>

              {isExpanded &&
                items.map((item: SharedResource) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveToolView({
                        type: section.toolType,
                        spaceId: item.space_id,
                      });
                      onClose();
                    }}
                    className='w-full text-left px-3 py-2.5 text-sm rounded-md transition-colors flex items-center justify-between cursor-pointer text-default-500 hover:bg-content2/50 hover:text-foreground'
                  >
                    <div className='flex flex-col min-w-0 flex-1'>
                      <span className='truncate text-foreground'>
                        {item.name}
                      </span>
                      <span className='text-xs text-default-400 truncate'>
                        from {item.owner_username}
                      </span>
                    </div>
                    <span className='ml-2 text-xs text-default-400 flex-shrink-0'>
                      {item.permission}
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && onClose()}
      size='lg'
      backdrop='opaque'
    >
      <ModalContent>
        <ModalHeader>Shared with Me</ModalHeader>
        <ModalBody className='pb-6'>{renderContent()}</ModalBody>
      </ModalContent>
    </Modal>
  );
}
