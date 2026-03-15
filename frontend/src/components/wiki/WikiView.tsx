import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tooltip,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClockRotateLeft,
  faShield,
  faTrash,
  faBars,
  faXmark,
  faFileLines,
  faPen,
  faEye,
} from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { WikiPage } from '../../types';
import type { WikiPagePath } from '../../services/api';
import { useChatStore } from '../../stores/chatStore';
import { WikiSidebar } from './WikiSidebar';
import { WikiBreadcrumb } from './WikiBreadcrumb';
import { WikiVersionHistory } from './WikiVersionHistory';
import { WikiPermissions } from './WikiPermissions';
import { WikiPageEditor } from './WikiPageEditor';

interface Props {
  spaceId: string;
}

export function WikiView({ spaceId }: Props) {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [myPermission, setMyPermission] = useState('view');

  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<
    (WikiPage & { path: WikiPagePath[] }) | null
  >(null);
  const [pageLoading, setPageLoading] = useState(false);

  const sidebarOpen = useChatStore((s) => s.wikiSidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setWikiSidebarOpen);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);

  const canEdit = myPermission === 'edit' || myPermission === 'owner';

  // Load tree
  const loadTree = useCallback(async () => {
    try {
      const { pages: p, my_permission } = await api.getWikiTree(spaceId);
      setPages(p);
      setMyPermission(my_permission);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Load a specific page
  const loadPage = useCallback(
    async (pageId: string) => {
      setPageLoading(true);
      try {
        const page = await api.getWikiPage(spaceId, pageId);
        setActivePage(page);
        if (page.my_permission) setMyPermission(page.my_permission);
      } catch {
        // ignore
      } finally {
        setPageLoading(false);
      }
    },
    [spaceId],
  );

  const handleSelectPage = useCallback(
    (pageId: string) => {
      setActivePageId(pageId);
      setEditing(false);
      if (pageId) {
        loadPage(pageId);
      } else {
        setActivePage(null);
      }
    },
    [loadPage],
  );

  // Page creation
  const handleCreatePage = useCallback(
    async (title: string, parentId: string | null) => {
      try {
        const page = await api.createWikiPage(spaceId, {
          title,
          parent_id: parentId || undefined,
          is_folder: false,
        });
        await loadTree();
        handleSelectPage(page.id);
      } catch {
        // ignore
      }
    },
    [spaceId, loadTree, handleSelectPage],
  );

  const handleCreateFolder = useCallback(
    async (title: string, parentId: string | null) => {
      try {
        await api.createWikiPage(spaceId, {
          title,
          parent_id: parentId || undefined,
          is_folder: true,
        });
        await loadTree();
      } catch {
        // ignore
      }
    },
    [spaceId, loadTree],
  );

  // Page operations
  const handleMovePage = useCallback(
    async (pageId: string, newParentId: string | null) => {
      try {
        await api.moveWikiPage(spaceId, pageId, newParentId);
        await loadTree();
      } catch {
        // ignore
      }
    },
    [spaceId, loadTree],
  );

  const handleRenamePage = useCallback(
    async (pageId: string, newTitle: string) => {
      try {
        await api.updateWikiPage(spaceId, pageId, { title: newTitle });
        await loadTree();
        if (activePageId === pageId && activePage) {
          setActivePage((prev) => (prev ? { ...prev, title: newTitle } : null));
        }
      } catch {
        // ignore
      }
    },
    [spaceId, loadTree, activePageId, activePage],
  );

  const handleDeletePage = useCallback(
    async (pageId: string) => {
      if (!confirm('Delete this page? This action cannot be undone.')) return;
      try {
        await api.deleteWikiPage(spaceId, pageId);
        await loadTree();
        if (activePageId === pageId) {
          setActivePageId(null);
          setActivePage(null);
        }
      } catch {
        // ignore
      }
    },
    [spaceId, loadTree, activePageId],
  );

  const handleDeleteActivePage = async () => {
    if (!activePageId) return;
    setDeleting(true);
    try {
      await api.deleteWikiPage(spaceId, activePageId);
      await loadTree();
      setActivePageId(null);
      setActivePage(null);
      setShowDeleteConfirm(false);
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  };

  // Save page content
  const handleVersionRevert = useCallback(async () => {
    if (activePageId) {
      await loadPage(activePageId);
      await loadTree();
    }
  }, [activePageId, loadPage, loadTree]);

  const handleBreadcrumbNavigate = useCallback(
    (pageId: string) => {
      if (pageId) {
        handleSelectPage(pageId);
      } else {
        setActivePageId(null);
        setActivePage(null);
      }
    },
    [handleSelectPage],
  );

  if (loading) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <Spinner size='lg' />
      </div>
    );
  }

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <div className='flex flex-1 overflow-hidden'>
        {/* Sidebar */}
        <div
          className={`shrink-0 border-r border-default-100 flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out ${sidebarOpen ? 'w-[280px]' : 'w-0 border-r-0'}`}
        >
          <div className='flex items-center justify-between px-3 py-2 border-b border-default-100 min-w-[280px]'>
            <span className='text-sm font-semibold text-foreground'>Pages</span>
            <Button
              isIconOnly
              variant='light'
              size='sm'
              onPress={() => setSidebarOpen(false)}
              title='Collapse sidebar'
            >
              <FontAwesomeIcon icon={faXmark} className='text-xs' />
            </Button>
          </div>
          <div className='min-w-[280px] flex-1 overflow-hidden'>
            <WikiSidebar
              spaceId={spaceId}
              pages={pages}
              activePageId={activePageId}
              onSelectPage={handleSelectPage}
              onCreatePage={handleCreatePage}
              onCreateFolder={handleCreateFolder}
              onMovePage={handleMovePage}
              onRenamePage={handleRenamePage}
              onDeletePage={handleDeletePage}
              canEdit={canEdit}
              onRefreshTree={loadTree}
            />
          </div>
        </div>

        {/* Main content */}
        <div className='flex-1 flex flex-col overflow-hidden min-w-0'>
          {/* Header */}
          <div className='flex items-center gap-2 px-4 py-2 border-b border-default-100'>
            {!sidebarOpen && (
              <Button
                isIconOnly
                variant='light'
                size='sm'
                onPress={() => setSidebarOpen(true)}
                title='Open sidebar'
              >
                <FontAwesomeIcon icon={faBars} className='text-xs' />
              </Button>
            )}

            <div className='flex-1 min-w-0'>
              {activePage ? (
                <WikiBreadcrumb
                  path={activePage.path || []}
                  onNavigate={handleBreadcrumbNavigate}
                />
              ) : (
                <span className='text-sm text-default-400'>Wiki</span>
              )}
            </div>

            {activePage && (
              <div className='flex items-center gap-1 shrink-0'>
                {canEdit && (
                  <Button
                    size='sm'
                    variant='solid'
                    color='primary'
                    startContent={
                      <FontAwesomeIcon
                        icon={editing ? faEye : faPen}
                        className='text-xs'
                      />
                    }
                    onPress={async () => {
                      if (editing && activePageId && activePage) {
                        // Flush any pending auto-save, then create a major version
                        try {
                          if (flushSaveRef.current) {
                            await flushSaveRef.current();
                          }
                          await api.updateWikiPage(spaceId, activePageId, {
                            create_version: true,
                          });
                        } catch {
                          // ignore
                        }
                      }
                      setEditing((prev) => !prev);
                    }}
                  >
                    {editing ? 'View' : 'Edit'}
                  </Button>
                )}
                <Tooltip content='Version history'>
                  <Button
                    isIconOnly
                    variant='light'
                    size='sm'
                    onPress={() => setShowVersionHistory(true)}
                  >
                    <FontAwesomeIcon
                      icon={faClockRotateLeft}
                      className='text-xs'
                    />
                  </Button>
                </Tooltip>
                {myPermission === 'owner' && (
                  <Tooltip content='Permissions'>
                    <Button
                      isIconOnly
                      variant='light'
                      size='sm'
                      onPress={() => setShowPermissions(true)}
                    >
                      <FontAwesomeIcon icon={faShield} className='text-xs' />
                    </Button>
                  </Tooltip>
                )}
                {canEdit && editing && (
                  <Tooltip content='Delete page'>
                    <Button
                      isIconOnly
                      variant='light'
                      size='sm'
                      color='danger'
                      onPress={() => setShowDeleteConfirm(true)}
                    >
                      <FontAwesomeIcon icon={faTrash} className='text-xs' />
                    </Button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          {/* Page content */}
          <div className='flex-1 overflow-y-auto'>
            {pageLoading ? (
              <div className='flex items-center justify-center py-16'>
                <Spinner size='lg' />
              </div>
            ) : activePage ? (
              <div className='px-8 py-6 mx-auto w-full'>
                <WikiPageEditor
                  key={activePage.id}
                  spaceId={spaceId}
                  page={activePage}
                  canEdit={canEdit && editing}
                  flushSaveRef={flushSaveRef}
                  onSave={(updated) => {
                    setActivePage((prev) =>
                      prev ? { ...prev, ...updated } : null,
                    );
                    loadTree();
                  }}
                />
              </div>
            ) : (
              <div className='flex flex-col items-center justify-center h-full text-default-400'>
                <FontAwesomeIcon icon={faFileLines} className='text-4xl mb-3' />
                <p className='text-lg mb-1'>
                  Select a page or create a new one
                </p>
                <p className='text-sm'>
                  Use the sidebar to navigate your wiki pages.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        size='sm'
      >
        <ModalContent>
          <ModalHeader>Delete Page</ModalHeader>
          <ModalBody>
            <p className='text-sm'>
              Are you sure you want to delete &ldquo;{activePage?.title}&rdquo;?
              {activePage?.is_folder && (
                <span className='text-danger'>
                  {' '}
                  This will also delete all child pages.
                </span>
              )}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='flat' onPress={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              color='danger'
              isLoading={deleting}
              onPress={handleDeleteActivePage}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Version history modal */}
      {activePageId && (
        <WikiVersionHistory
          spaceId={spaceId}
          pageId={activePageId}
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          onRevert={handleVersionRevert}
        />
      )}

      {/* Permissions modal */}
      <WikiPermissions
        spaceId={spaceId}
        pageId={activePageId || undefined}
        isOpen={showPermissions}
        onClose={() => setShowPermissions(false)}
        myPermission={myPermission}
      />
    </div>
  );
}
