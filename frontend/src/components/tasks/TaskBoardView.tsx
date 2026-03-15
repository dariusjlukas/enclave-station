import { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Spinner,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faGrip,
  faList,
  faChartGantt,
  faChevronLeft,
  faTrash,
  faPen,
  faShield,
} from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { TaskBoard, TaskItem, TaskColumn, TaskLabel } from '../../types';
import { BoardKanban } from './BoardKanban';
import { BoardList } from './BoardList';
import { GanttChart } from './GanttChart';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskPermissions } from './TaskPermissions';

interface Props {
  spaceId: string;
}

export function TaskBoardView({ spaceId }: Props) {
  const [boards, setBoards] = useState<TaskBoard[]>([]);
  const [activeBoard, setActiveBoard] = useState<TaskBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'gantt'>(
    'kanban',
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [myPermission, setMyPermission] = useState('view');
  const [showPermissions, setShowPermissions] = useState(false);

  // Board creation
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Board editing
  const [editingBoard, setEditingBoard] = useState(false);
  const [editBoardName, setEditBoardName] = useState('');
  const [editBoardDesc, setEditBoardDesc] = useState('');

  const canEdit = myPermission === 'edit' || myPermission === 'owner';

  const loadBoards = useCallback(async () => {
    try {
      const { boards: b, my_permission } = await api.listTaskBoards(spaceId);
      setBoards(b);
      setMyPermission(my_permission);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  const loadBoard = useCallback(
    async (boardId: string) => {
      try {
        const board = await api.getTaskBoard(spaceId, boardId);
        setActiveBoard(board);
        if (board.my_permission) setMyPermission(board.my_permission);
      } catch {
        // ignore
      }
    },
    [spaceId],
  );

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  const handleCreateBoard = async () => {
    if (!newBoardName.trim()) return;
    setCreating(true);
    try {
      const board = await api.createTaskBoard(spaceId, {
        name: newBoardName.trim(),
        description: newBoardDesc.trim(),
      });
      setBoards((prev) => [...prev, board]);
      setActiveBoard(board);
      await loadBoard(board.id);
      setNewBoardName('');
      setNewBoardDesc('');
      setShowCreateBoard(false);
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBoard = async (boardId: string) => {
    if (!confirm('Delete this board and all its tasks?')) return;
    try {
      await api.deleteTaskBoard(spaceId, boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
      if (activeBoard?.id === boardId) setActiveBoard(null);
    } catch {
      // ignore
    }
  };

  const handleUpdateBoard = async () => {
    if (!activeBoard || !editBoardName.trim()) return;
    try {
      const updated = await api.updateTaskBoard(spaceId, activeBoard.id, {
        name: editBoardName.trim(),
        description: editBoardDesc.trim(),
      });
      setActiveBoard((prev) => (prev ? { ...prev, ...updated } : null));
      setBoards((prev) =>
        prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)),
      );
      setEditingBoard(false);
    } catch {
      // ignore
    }
  };

  const handleTaskUpdate = useCallback(async () => {
    if (activeBoard) await loadBoard(activeBoard.id);
  }, [activeBoard, loadBoard]);

  if (loading) {
    return (
      <div className='flex-1 flex items-center justify-center'>
        <Spinner size='lg' />
      </div>
    );
  }

  // Board list view (no active board selected)
  if (!activeBoard) {
    return (
      <div className='flex-1 flex flex-col overflow-hidden'>
        <div className='flex items-center justify-between p-4 border-b border-divider'>
          <h2 className='text-lg font-semibold'>Task Boards</h2>
          {canEdit && (
            <Button
              size='sm'
              color='primary'
              startContent={<FontAwesomeIcon icon={faPlus} />}
              onPress={() => setShowCreateBoard(true)}
            >
              New Board
            </Button>
          )}
        </div>

        <div className='flex-1 overflow-y-auto p-4'>
          {boards.length === 0 && (
            <div className='text-center py-12 text-default-400'>
              <p className='text-lg mb-2'>No boards yet</p>
              {canEdit && (
                <p className='text-sm'>
                  Create a board to start tracking tasks.
                </p>
              )}
            </div>
          )}

          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => loadBoard(board.id)}
                className='text-left p-4 rounded-lg bg-content2 hover:bg-content3 border border-divider transition-colors group'
              >
                <h3 className='font-semibold text-foreground'>{board.name}</h3>
                {board.description && (
                  <p className='text-sm text-default-400 mt-1 line-clamp-2'>
                    {board.description}
                  </p>
                )}
                <p className='text-xs text-default-400 mt-2'>
                  Created by {board.created_by_username}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Create board modal */}
        <Modal
          isOpen={showCreateBoard}
          onClose={() => setShowCreateBoard(false)}
          size='md'
        >
          <ModalContent>
            <ModalHeader>New Board</ModalHeader>
            <ModalBody>
              <input
                type='text'
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder='Board name'
                className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm'
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateBoard()}
              />
              <input
                type='text'
                value={newBoardDesc}
                onChange={(e) => setNewBoardDesc(e.target.value)}
                placeholder='Description (optional)'
                className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm'
              />
            </ModalBody>
            <ModalFooter>
              <Button variant='flat' onPress={() => setShowCreateBoard(false)}>
                Cancel
              </Button>
              <Button
                color='primary'
                isLoading={creating}
                onPress={handleCreateBoard}
              >
                Create
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Permission modal */}
        {showPermissions && (
          <TaskPermissions
            spaceId={spaceId}
            onClose={() => setShowPermissions(false)}
          />
        )}
      </div>
    );
  }

  // Active board view
  const columns: TaskColumn[] = activeBoard.columns || [];
  const tasks: TaskItem[] = activeBoard.tasks || [];
  const boardLabels: TaskLabel[] = activeBoard.board_labels || [];

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Board header */}
      <div className='flex items-center gap-3 px-4 py-3 border-b border-divider'>
        <Button
          isIconOnly
          variant='light'
          size='sm'
          onPress={() => setActiveBoard(null)}
          title='Back to boards'
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </Button>

        {editingBoard ? (
          <div className='flex items-center gap-2 flex-1'>
            <input
              type='text'
              value={editBoardName}
              onChange={(e) => setEditBoardName(e.target.value)}
              className='px-2 py-1 rounded bg-content2 border border-divider text-sm font-semibold'
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleUpdateBoard()}
            />
            <input
              type='text'
              value={editBoardDesc}
              onChange={(e) => setEditBoardDesc(e.target.value)}
              className='px-2 py-1 rounded bg-content2 border border-divider text-sm flex-1'
              placeholder='Description...'
            />
            <Button size='sm' color='primary' onPress={handleUpdateBoard}>
              Save
            </Button>
            <Button
              size='sm'
              variant='flat'
              onPress={() => setEditingBoard(false)}
            >
              Cancel
            </Button>
            <Button
              isIconOnly
              size='sm'
              variant='light'
              color='danger'
              onPress={() => handleDeleteBoard(activeBoard.id)}
              title='Delete board'
            >
              <FontAwesomeIcon icon={faTrash} className='text-xs' />
            </Button>
          </div>
        ) : (
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2'>
              <h2 className='text-lg font-semibold truncate'>
                {activeBoard.name}
              </h2>
              {canEdit && (
                <Button
                  isIconOnly
                  variant='light'
                  size='sm'
                  onPress={() => {
                    setEditBoardName(activeBoard.name);
                    setEditBoardDesc(activeBoard.description);
                    setEditingBoard(true);
                  }}
                  title='Edit board'
                >
                  <FontAwesomeIcon icon={faPen} className='text-xs' />
                </Button>
              )}
            </div>
            {activeBoard.description && (
              <p className='text-xs text-default-400 truncate'>
                {activeBoard.description}
              </p>
            )}
          </div>
        )}

        <div className='flex items-center gap-1'>
          {myPermission === 'owner' && (
            <Button
              isIconOnly
              variant='light'
              size='sm'
              onPress={() => setShowPermissions(true)}
              title='Manage permissions'
            >
              <FontAwesomeIcon icon={faShield} className='text-xs' />
            </Button>
          )}
          <div className='flex rounded-lg overflow-hidden border border-divider'>
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 text-xs ${
                viewMode === 'kanban'
                  ? 'bg-primary text-white'
                  : 'bg-content2 text-default-500 hover:bg-content3'
              }`}
              title='Kanban view'
            >
              <FontAwesomeIcon icon={faGrip} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs ${
                viewMode === 'list'
                  ? 'bg-primary text-white'
                  : 'bg-content2 text-default-500 hover:bg-content3'
              }`}
              title='List view'
            >
              <FontAwesomeIcon icon={faList} />
            </button>
            <button
              onClick={() => setViewMode('gantt')}
              className={`px-3 py-1.5 text-xs ${
                viewMode === 'gantt'
                  ? 'bg-primary text-white'
                  : 'bg-content2 text-default-500 hover:bg-content3'
              }`}
              title='Gantt chart'
            >
              <FontAwesomeIcon icon={faChartGantt} />
            </button>
          </div>
        </div>
      </div>

      {/* Board content */}
      {viewMode === 'kanban' ? (
        <BoardKanban
          spaceId={spaceId}
          board={activeBoard}
          columns={columns}
          tasks={tasks}
          boardLabels={boardLabels}
          canEdit={canEdit}
          onTaskClick={(taskId) => setSelectedTaskId(taskId)}
          onRefresh={handleTaskUpdate}
        />
      ) : viewMode === 'list' ? (
        <BoardList
          spaceId={spaceId}
          board={activeBoard}
          columns={columns}
          tasks={tasks}
          boardLabels={boardLabels}
          canEdit={canEdit}
          onTaskClick={(taskId) => setSelectedTaskId(taskId)}
          onRefresh={handleTaskUpdate}
        />
      ) : (
        <GanttChart
          spaceId={spaceId}
          board={activeBoard}
          columns={columns}
          tasks={tasks}
          dependencies={activeBoard.dependencies || []}
          canEdit={canEdit}
          onTaskClick={(taskId) => setSelectedTaskId(taskId)}
          onRefresh={handleTaskUpdate}
        />
      )}

      {/* Task detail modal */}
      {selectedTaskId && activeBoard && (
        <TaskDetailModal
          spaceId={spaceId}
          boardId={activeBoard.id}
          taskId={selectedTaskId}
          columns={columns}
          boardLabels={boardLabels}
          canEdit={canEdit}
          spaceMembers={[]}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={handleTaskUpdate}
        />
      )}

      {/* Permissions modal */}
      {showPermissions && (
        <TaskPermissions
          spaceId={spaceId}
          onClose={() => setShowPermissions(false)}
        />
      )}
    </div>
  );
}
