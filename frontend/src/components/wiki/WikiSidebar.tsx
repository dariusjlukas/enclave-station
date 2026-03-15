import { useState, useCallback, useRef, useMemo } from 'react';
import { Button, Tooltip } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faFolderPlus,
  faFolder,
  faFolderOpen,
  faFileLines,
  faChevronRight,
  faChevronDown,
  faEllipsisVertical,
  faPen,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import type { WikiPage } from '../../types';

interface Props {
  spaceId: string;
  pages: WikiPage[];
  activePageId: string | null;
  onSelectPage: (pageId: string) => void;
  onCreatePage: (title: string, parentId: string | null) => void;
  onCreateFolder: (title: string, parentId: string | null) => void;
  onMovePage: (pageId: string, newParentId: string | null) => void;
  onRenamePage: (pageId: string, newTitle: string) => void;
  onDeletePage: (pageId: string) => void;
  canEdit: boolean;
  onRefreshTree: () => void;
}

interface TreeNode {
  page: WikiPage;
  children: TreeNode[];
}

function buildTree(pages: WikiPage[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Create nodes
  for (const page of pages) {
    map.set(page.id, { page, children: [] });
  }

  // Build hierarchy
  for (const page of pages) {
    const node = map.get(page.id)!;
    if (page.parent_id && map.has(page.parent_id)) {
      map.get(page.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort by position
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.page.position - b.page.position);
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);

  return roots;
}

export function WikiSidebar({
  pages,
  activePageId,
  onSelectPage,
  onCreatePage,
  onCreateFolder,
  onMovePage,
  onRenamePage,
  onDeletePage,
  canEdit,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creatingType, setCreatingType] = useState<'page' | 'folder' | null>(
    null,
  );
  const [newItemTitle, setNewItemTitle] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    pageId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sidebarRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(pages), [pages]);

  const toggleExpand = useCallback((pageId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }, []);

  const handleCreateSubmit = () => {
    const title = newItemTitle.trim();
    if (!title) return;
    if (creatingType === 'folder') {
      onCreateFolder(title, null);
    } else {
      onCreatePage(title, null);
    }
    setNewItemTitle('');
    setCreatingType(null);
  };

  const handleRenameSubmit = (pageId: string) => {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    onRenamePage(pageId, title);
    setRenamingId(null);
  };

  const handleContextAction = (action: string, pageId: string) => {
    setContextMenu(null);
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;

    switch (action) {
      case 'rename':
        setRenamingId(pageId);
        setRenameValue(page.title);
        break;
      case 'delete':
        onDeletePage(pageId);
        break;
      case 'new-page':
        setCreatingType('page');
        setExpanded((prev) => new Set([...prev, pageId]));
        break;
    }
  };

  // Drag and drop
  const handleDragStart = (e: React.DragEvent, pageId: string) => {
    e.dataTransfer.setData('text/plain', pageId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, pageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(pageId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetId) return;
    onMovePage(draggedId, targetId);
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId) return;
    onMovePage(draggedId, null);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const { page } = node;
    const isActive = page.id === activePageId;
    const isExpanded = expanded.has(page.id);
    const isRenaming = renamingId === page.id;
    const isDragOver = dragOverId === page.id;

    return (
      <div key={page.id}>
        <div
          className={`group flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer transition-colors text-sm ${
            isActive
              ? 'bg-primary/20 text-primary font-medium'
              : isDragOver && page.is_folder
                ? 'bg-primary/10 ring-1 ring-primary/40'
                : 'text-foreground hover:bg-content2'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          draggable={canEdit}
          onDragStart={(e) => handleDragStart(e, page.id)}
          onDragOver={(e) => {
            if (page.is_folder) handleDragOver(e, page.id);
          }}
          onDragLeave={handleDragLeave}
          onDrop={(e) => {
            if (page.is_folder) handleDrop(e, page.id);
          }}
          onClick={() => {
            if (isRenaming) return;
            onSelectPage(page.id);
          }}
          onContextMenu={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            setContextMenu({ pageId: page.id, x: e.clientX, y: e.clientY });
          }}
        >
          {/* Expand toggle for folders */}
          {page.is_folder ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(page.id);
              }}
              className='w-4 h-4 flex items-center justify-center shrink-0 text-default-400'
            >
              <FontAwesomeIcon
                icon={isExpanded ? faChevronDown : faChevronRight}
                className='text-[10px]'
              />
            </button>
          ) : (
            <span className='w-4 shrink-0' />
          )}

          {/* Icon */}
          <FontAwesomeIcon
            icon={
              page.is_folder
                ? isExpanded
                  ? faFolderOpen
                  : faFolder
                : faFileLines
            }
            className={`text-xs shrink-0 ${
              page.is_folder ? 'text-warning' : 'text-default-400'
            }`}
          />

          {/* Title */}
          {isRenaming ? (
            <input
              type='text'
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit(page.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onBlur={() => handleRenameSubmit(page.id)}
              className='flex-1 min-w-0 px-1 py-0 bg-content2 border border-divider rounded text-sm'
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className='flex-1 min-w-0 truncate'>{page.title}</span>
          )}

          {/* Context menu button */}
          {canEdit && !isRenaming && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({
                  pageId: page.id,
                  x: rect.right,
                  y: rect.bottom,
                });
              }}
              className='opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center shrink-0 text-default-400 hover:text-foreground transition-opacity'
            >
              <FontAwesomeIcon icon={faEllipsisVertical} className='text-xs' />
            </button>
          )}
        </div>

        {/* Children */}
        {page.is_folder && isExpanded && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
            {node.children.length === 0 && (
              <div
                className='text-xs text-default-400 py-1'
                style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
              >
                Empty folder
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={sidebarRef}
      className='flex flex-col h-full'
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleRootDrop}
    >
      {/* Header buttons */}
      {canEdit && (
        <div className='flex items-center gap-1 p-2 border-b border-divider'>
          <Tooltip content='New Page'>
            <Button
              size='sm'
              variant='flat'
              startContent={
                <FontAwesomeIcon icon={faPlus} className='text-xs' />
              }
              onPress={() => {
                setCreatingType('page');
                setNewItemTitle('');
              }}
              className='flex-1'
            >
              Page
            </Button>
          </Tooltip>
          <Tooltip content='New Folder'>
            <Button
              size='sm'
              variant='flat'
              startContent={
                <FontAwesomeIcon icon={faFolderPlus} className='text-xs' />
              }
              onPress={() => {
                setCreatingType('folder');
                setNewItemTitle('');
              }}
              className='flex-1'
            >
              Folder
            </Button>
          </Tooltip>
        </div>
      )}

      {/* Inline create input */}
      {creatingType && (
        <div className='p-2 border-b border-divider'>
          <div className='flex items-center gap-1.5'>
            <FontAwesomeIcon
              icon={creatingType === 'folder' ? faFolder : faFileLines}
              className={`text-xs ${creatingType === 'folder' ? 'text-warning' : 'text-default-400'}`}
            />
            <input
              type='text'
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              placeholder={`New ${creatingType} name...`}
              className='flex-1 min-w-0 px-2 py-1 bg-content2 border border-divider rounded text-sm'
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSubmit();
                if (e.key === 'Escape') setCreatingType(null);
              }}
              onBlur={() => {
                if (!newItemTitle.trim()) setCreatingType(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Tree */}
      <div className='flex-1 overflow-y-auto py-1'>
        {tree.length === 0 ? (
          <div className='text-center py-8 px-4'>
            <p className='text-sm text-default-400'>No pages yet</p>
            {canEdit && (
              <p className='text-xs text-default-400 mt-1'>
                Create a page to get started.
              </p>
            )}
          </div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          {/* Backdrop to close */}
          <div
            className='fixed inset-0 z-50'
            onClick={() => setContextMenu(null)}
          />
          <div
            className='fixed z-50 bg-content1 border border-divider rounded-lg shadow-lg py-1 min-w-[140px]'
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => handleContextAction('rename', contextMenu.pageId)}
              className='w-full text-left px-3 py-1.5 text-sm hover:bg-content2 flex items-center gap-2'
            >
              <FontAwesomeIcon icon={faPen} className='text-xs w-4' />
              Rename
            </button>
            {pages.find((p) => p.id === contextMenu.pageId)?.is_folder && (
              <button
                onClick={() =>
                  handleContextAction('new-page', contextMenu.pageId)
                }
                className='w-full text-left px-3 py-1.5 text-sm hover:bg-content2 flex items-center gap-2'
              >
                <FontAwesomeIcon icon={faPlus} className='text-xs w-4' />
                New Page Inside
              </button>
            )}
            <button
              onClick={() => handleContextAction('delete', contextMenu.pageId)}
              className='w-full text-left px-3 py-1.5 text-sm hover:bg-content2 text-danger flex items-center gap-2'
            >
              <FontAwesomeIcon icon={faTrash} className='text-xs w-4' />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
