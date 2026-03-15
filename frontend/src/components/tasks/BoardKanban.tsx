import { useState, useRef, useCallback } from 'react';
import { Button } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faEllipsisVertical,
  faTrash,
  faPen,
} from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { TaskBoard, TaskItem, TaskColumn, TaskLabel } from '../../types';
import { TaskCard } from './TaskCard';

interface Props {
  spaceId: string;
  board: TaskBoard;
  columns: TaskColumn[];
  tasks: TaskItem[];
  boardLabels: TaskLabel[];
  canEdit: boolean;
  onTaskClick: (taskId: string) => void;
  onRefresh: () => void;
}

export function BoardKanban({
  spaceId,
  board,
  columns,
  tasks,
  boardLabels,
  canEdit,
  onTaskClick,
  onRefresh,
}: Props) {
  const [addingTaskInColumn, setAddingTaskInColumn] = useState<string | null>(
    null,
  );
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editColumnName, setEditColumnName] = useState('');
  const [columnMenuId, setColumnMenuId] = useState<string | null>(null);
  const [editColumnWip, setEditColumnWip] = useState(0);

  // Drag and drop state
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<number | null>(null);
  const dragRef = useRef<{ taskId: string; sourceColumn: string } | null>(null);

  const getColumnTasks = useCallback(
    (columnId: string) =>
      tasks
        .filter((t) => t.column_id === columnId)
        .sort((a, b) => a.position - b.position),
    [tasks],
  );

  const handleAddTask = async (columnId: string) => {
    if (!newTaskTitle.trim()) return;
    const colTasks = getColumnTasks(columnId);
    const maxPos =
      colTasks.length > 0
        ? Math.max(...colTasks.map((t) => t.position)) + 1
        : 0;
    try {
      await api.createTask(spaceId, board.id, {
        column_id: columnId,
        title: newTaskTitle.trim(),
        position: maxPos,
      });
      setNewTaskTitle('');
      setAddingTaskInColumn(null);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) return;
    try {
      await api.createTaskColumn(spaceId, board.id, {
        name: newColumnName.trim(),
        position: columns.length,
      });
      setNewColumnName('');
      setAddingColumn(false);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    const colTasks = getColumnTasks(columnId);
    if (colTasks.length > 0) {
      alert('Move or delete all tasks in this column first.');
      return;
    }
    try {
      await api.deleteTaskColumn(spaceId, board.id, columnId);
      setColumnMenuId(null);
      onRefresh();
    } catch {
      // ignore
    }
  };

  const handleUpdateColumn = async (columnId: string) => {
    if (!editColumnName.trim()) return;
    try {
      await api.updateTaskColumn(spaceId, board.id, columnId, {
        name: editColumnName.trim(),
        wip_limit: editColumnWip,
      });
      setEditingColumnId(null);
      onRefresh();
    } catch {
      // ignore
    }
  };

  // Drag handlers
  const handleDragStart = (taskId: string, columnId: string) => {
    setDragTaskId(taskId);
    dragRef.current = { taskId, sourceColumn: columnId };
  };

  const handleDragOver = (
    e: React.DragEvent,
    columnId: string,
    position: number,
  ) => {
    e.preventDefault();
    setDragOverColumn(columnId);
    setDragOverPosition(position);
  };

  const handleDragEnd = async () => {
    if (!dragRef.current || !dragOverColumn || dragOverPosition === null) {
      setDragTaskId(null);
      setDragOverColumn(null);
      setDragOverPosition(null);
      return;
    }

    const { taskId } = dragRef.current;
    const targetColumn = dragOverColumn;
    const targetPosition = dragOverPosition;

    // Build the new task order for the target column
    const targetTasks = getColumnTasks(targetColumn).filter(
      (t) => t.id !== taskId,
    );
    targetTasks.splice(targetPosition, 0, { id: taskId } as TaskItem);

    const reorderPayload = targetTasks.map((t, i) => ({
      id: t.id,
      column_id: targetColumn,
      position: i,
    }));

    // If source column is different, reorder source column too
    if (dragRef.current.sourceColumn !== targetColumn) {
      const sourceTasks = getColumnTasks(dragRef.current.sourceColumn).filter(
        (t) => t.id !== taskId,
      );
      sourceTasks.forEach((t, i) => {
        reorderPayload.push({
          id: t.id,
          column_id: dragRef.current!.sourceColumn,
          position: i,
        });
      });
    }

    setDragTaskId(null);
    setDragOverColumn(null);
    setDragOverPosition(null);
    dragRef.current = null;

    try {
      await api.reorderTasks(spaceId, board.id, reorderPayload);
      onRefresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className='flex-1 overflow-x-auto overflow-y-hidden'>
      <div className='flex gap-3 p-4 h-full min-w-max'>
        {columns.map((col) => {
          const colTasks = getColumnTasks(col.id);
          const isOverWip =
            col.wip_limit > 0 && colTasks.length >= col.wip_limit;

          return (
            <div
              key={col.id}
              className='flex flex-col w-72 shrink-0 rounded-lg bg-content2/50'
              onDragOver={(e) => handleDragOver(e, col.id, colTasks.length)}
              onDrop={handleDragEnd}
            >
              {/* Column header */}
              <div className='flex items-center justify-between px-3 py-2.5 border-b border-divider/50'>
                {editingColumnId === col.id ? (
                  <div className='flex-1 flex flex-col gap-1'>
                    <input
                      type='text'
                      value={editColumnName}
                      onChange={(e) => setEditColumnName(e.target.value)}
                      className='w-full px-2 py-1 rounded bg-content1 border border-divider text-sm'
                      autoFocus
                      onKeyDown={(e) =>
                        e.key === 'Enter' && handleUpdateColumn(col.id)
                      }
                    />
                    <div className='flex items-center gap-2'>
                      <label className='text-xs text-default-400'>
                        WIP limit:
                      </label>
                      <input
                        type='number'
                        value={editColumnWip}
                        onChange={(e) =>
                          setEditColumnWip(parseInt(e.target.value) || 0)
                        }
                        className='w-16 px-2 py-0.5 rounded bg-content1 border border-divider text-xs'
                        min={0}
                      />
                    </div>
                    <div className='flex gap-1 mt-1'>
                      <Button
                        size='sm'
                        color='primary'
                        className='h-6 min-w-0 text-xs'
                        onPress={() => handleUpdateColumn(col.id)}
                      >
                        Save
                      </Button>
                      <Button
                        size='sm'
                        variant='flat'
                        className='h-6 min-w-0 text-xs'
                        onPress={() => setEditingColumnId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className='flex items-center gap-2 min-w-0'>
                      <span className='text-sm font-semibold text-foreground truncate'>
                        {col.name}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${
                          isOverWip
                            ? 'bg-danger/20 text-danger'
                            : 'bg-default-100 text-default-500'
                        }`}
                      >
                        {colTasks.length}
                        {col.wip_limit > 0 ? `/${col.wip_limit}` : ''}
                      </span>
                    </div>
                    {canEdit && (
                      <div className='relative'>
                        <Button
                          isIconOnly
                          variant='light'
                          size='sm'
                          className='h-6 w-6 min-w-0'
                          onPress={() =>
                            setColumnMenuId(
                              columnMenuId === col.id ? null : col.id,
                            )
                          }
                        >
                          <FontAwesomeIcon
                            icon={faEllipsisVertical}
                            className='text-xs'
                          />
                        </Button>
                        {columnMenuId === col.id && (
                          <div className='absolute right-0 top-full mt-1 w-36 rounded-lg shadow-lg bg-content1 border border-divider z-10 py-1'>
                            <button
                              onClick={() => {
                                setEditColumnName(col.name);
                                setEditColumnWip(col.wip_limit);
                                setEditingColumnId(col.id);
                                setColumnMenuId(null);
                              }}
                              className='w-full text-left px-3 py-1.5 text-sm hover:bg-content2 flex items-center gap-2'
                            >
                              <FontAwesomeIcon
                                icon={faPen}
                                className='text-xs'
                              />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteColumn(col.id)}
                              className='w-full text-left px-3 py-1.5 text-sm hover:bg-content2 text-danger flex items-center gap-2'
                            >
                              <FontAwesomeIcon
                                icon={faTrash}
                                className='text-xs'
                              />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Tasks */}
              <div className='flex-1 overflow-y-auto p-2 space-y-2'>
                {colTasks.map((task, index) => (
                  <div
                    key={task.id}
                    draggable={canEdit}
                    onDragStart={() => handleDragStart(task.id, col.id)}
                    onDragOver={(e) => handleDragOver(e, col.id, index)}
                    onDragEnd={handleDragEnd}
                    className={`${dragTaskId === task.id ? 'opacity-30' : ''} ${
                      dragOverColumn === col.id && dragOverPosition === index
                        ? 'border-t-2 border-primary'
                        : ''
                    }`}
                  >
                    <TaskCard
                      task={task}
                      boardLabels={boardLabels}
                      onClick={() => onTaskClick(task.id)}
                      canDrag={canEdit}
                    />
                  </div>
                ))}

                {/* Drop zone at end of column */}
                {dragTaskId && (
                  <div
                    className={`h-16 rounded-lg border-2 border-dashed transition-colors ${
                      dragOverColumn === col.id &&
                      dragOverPosition === colTasks.length
                        ? 'border-primary bg-primary/10'
                        : 'border-transparent'
                    }`}
                    onDragOver={(e) =>
                      handleDragOver(e, col.id, colTasks.length)
                    }
                    onDrop={handleDragEnd}
                  />
                )}

                {/* Add task form */}
                {canEdit && addingTaskInColumn === col.id ? (
                  <div className='p-2 rounded-lg bg-content1 border border-divider'>
                    <input
                      type='text'
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder='Task title...'
                      className='w-full px-2 py-1.5 rounded bg-content2 border border-divider text-sm mb-2'
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddTask(col.id);
                        if (e.key === 'Escape') setAddingTaskInColumn(null);
                      }}
                    />
                    <div className='flex gap-1'>
                      <Button
                        size='sm'
                        color='primary'
                        className='h-7 text-xs'
                        onPress={() => handleAddTask(col.id)}
                      >
                        Add
                      </Button>
                      <Button
                        size='sm'
                        variant='flat'
                        className='h-7 text-xs'
                        onPress={() => {
                          setAddingTaskInColumn(null);
                          setNewTaskTitle('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  canEdit && (
                    <button
                      onClick={() => {
                        setAddingTaskInColumn(col.id);
                        setNewTaskTitle('');
                      }}
                      className='w-full text-left px-2 py-1.5 text-sm text-default-400 hover:text-foreground hover:bg-content1 rounded-lg transition-colors flex items-center gap-1.5'
                    >
                      <FontAwesomeIcon icon={faPlus} className='text-xs' />
                      Add task
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}

        {/* Add column */}
        {canEdit &&
          (addingColumn ? (
            <div className='w-72 shrink-0 p-3 rounded-lg bg-content2/50'>
              <input
                type='text'
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                placeholder='Column name...'
                className='w-full px-2 py-1.5 rounded bg-content1 border border-divider text-sm mb-2'
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddColumn();
                  if (e.key === 'Escape') setAddingColumn(false);
                }}
              />
              <div className='flex gap-1'>
                <Button
                  size='sm'
                  color='primary'
                  className='h-7 text-xs'
                  onPress={handleAddColumn}
                >
                  Add
                </Button>
                <Button
                  size='sm'
                  variant='flat'
                  className='h-7 text-xs'
                  onPress={() => {
                    setAddingColumn(false);
                    setNewColumnName('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingColumn(true)}
              className='w-72 shrink-0 h-12 rounded-lg border-2 border-dashed border-default-200 text-default-400 hover:text-foreground hover:border-default-300 flex items-center justify-center gap-2 text-sm transition-colors'
            >
              <FontAwesomeIcon icon={faPlus} />
              Add column
            </button>
          ))}
      </div>
    </div>
  );
}
