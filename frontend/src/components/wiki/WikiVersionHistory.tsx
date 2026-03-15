import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Spinner,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClockRotateLeft,
  faChevronDown,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { WikiPageVersion } from '../../types';

interface Props {
  spaceId: string;
  pageId: string;
  isOpen: boolean;
  onClose: () => void;
  onRevert: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function WikiVersionHistory({
  spaceId,
  pageId,
  isOpen,
  onClose,
  onRevert,
}: Props) {
  const [versions, setVersions] = useState<WikiPageVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setExpandedId(null);
    api
      .listWikiPageVersions(spaceId, pageId)
      .then(({ versions: v }) => setVersions(v))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, spaceId, pageId]);

  const handleToggleExpand = async (versionId: string) => {
    if (expandedId === versionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(versionId);
    setLoadingContent(true);
    try {
      const version = await api.getWikiPageVersion(spaceId, pageId, versionId);
      setExpandedContent(version.content || version.content_text || '');
    } catch {
      setExpandedContent('Failed to load version content.');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleRevert = async (versionId: string) => {
    if (
      !confirm(
        'Revert to this version? The current content will be saved as a new version.',
      )
    )
      return;
    setReverting(versionId);
    try {
      await api.revertWikiPage(spaceId, pageId, versionId);
      onRevert();
      onClose();
    } catch {
      // ignore
    } finally {
      setReverting(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size='lg' scrollBehavior='inside'>
      <ModalContent>
        <ModalHeader className='flex items-center gap-2'>
          <FontAwesomeIcon icon={faClockRotateLeft} className='text-sm' />
          Version History
        </ModalHeader>
        <ModalBody>
          {loading ? (
            <div className='flex justify-center py-8'>
              <Spinner size='lg' />
            </div>
          ) : versions.length === 0 ? (
            <p className='text-sm text-default-400 text-center py-8'>
              No version history available.
            </p>
          ) : (
            <div className='space-y-2'>
              {versions.map((v) => (
                <div
                  key={v.id}
                  className='rounded-lg bg-content2 border border-divider overflow-hidden'
                >
                  <button
                    onClick={() => handleToggleExpand(v.id)}
                    className='w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-content3 transition-colors'
                  >
                    <div className='flex items-center gap-3 min-w-0'>
                      <FontAwesomeIcon
                        icon={
                          expandedId === v.id ? faChevronDown : faChevronRight
                        }
                        className='text-xs text-default-400 shrink-0'
                      />
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            v{v.version_number}
                          </span>
                          <span className='text-xs text-default-400'>
                            {v.title}
                          </span>
                        </div>
                        <div className='text-xs text-default-400'>
                          by {v.edited_by_username} &middot;{' '}
                          {formatRelativeTime(v.created_at)}
                        </div>
                      </div>
                    </div>
                    <Button
                      size='sm'
                      variant='flat'
                      color='primary'
                      isLoading={reverting === v.id}
                      onPress={() => {
                        handleRevert(v.id);
                      }}
                    >
                      Revert
                    </Button>
                  </button>

                  {expandedId === v.id && (
                    <div className='px-4 py-3 border-t border-divider bg-content1'>
                      {loadingContent ? (
                        <div className='flex justify-center py-4'>
                          <Spinner size='sm' />
                        </div>
                      ) : (
                        <pre className='text-xs text-default-500 whitespace-pre-wrap max-h-60 overflow-y-auto'>
                          {expandedContent}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='flat' onPress={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
