import { useState, useMemo } from 'react';

function parseDate(s: string): Date {
  let iso = s.replace(' ', 'T');
  iso = iso.replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso);
}

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (sortKey !== col)
    return (
      <FontAwesomeIcon icon={faSort} className='text-[10px] text-default-300' />
    );
  return (
    <FontAwesomeIcon
      icon={sortDir === 'asc' ? faSortUp : faSortDown}
      className='text-[10px] text-primary'
    />
  );
}
import { Button } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faSort,
  faSortUp,
  faSortDown,
  faFilter,
} from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { TaskBoard, TaskItem, TaskColumn, TaskLabel } from '../../types';

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

type SortKey = 'title' | 'priority' | 'due_date' | 'column' | 'created_at';
type SortDir = 'asc' | 'desc';

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-danger/20 text-danger',
  high: 'bg-warning/20 text-warning',
  medium: 'bg-primary/20 text-primary',
  low: 'bg-default-100 text-default-500',
};

export function BoardList({
  spaceId,
  board,
  columns,
  tasks,
  canEdit,
  onTaskClick,
  onRefresh,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('column');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterColumn, setFilterColumn] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');

  // Add task inline
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskColumn, setNewTaskColumn] = useState(columns[0]?.id || '');

  const columnMap = useMemo(() => {
    const m: Record<string, TaskColumn> = {};
    columns.forEach((c) => (m[c.id] = c));
    return m;
  }, [columns]);

  // Collect unique assignees
  const allAssignees = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((t) =>
      t.assignees?.forEach((a) =>
        map.set(a.user_id, a.display_name || a.username),
      ),
    );
    return Array.from(map.entries());
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (filterColumn !== 'all') {
      result = result.filter((t) => t.column_id === filterColumn);
    }
    if (filterPriority !== 'all') {
      result = result.filter((t) => t.priority === filterPriority);
    }
    if (filterAssignee !== 'all') {
      result = result.filter((t) =>
        t.assignees?.some((a) => a.user_id === filterAssignee),
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'priority':
          cmp =
            (PRIORITY_ORDER[a.priority] ?? 2) -
            (PRIORITY_ORDER[b.priority] ?? 2);
          break;
        case 'due_date':
          if (!a.due_date && !b.due_date) cmp = 0;
          else if (!a.due_date) cmp = 1;
          else if (!b.due_date) cmp = -1;
          else cmp = a.due_date.localeCompare(b.due_date);
          break;
        case 'column':
          cmp =
            (columnMap[a.column_id]?.position ?? 0) -
            (columnMap[b.column_id]?.position ?? 0);
          if (cmp === 0) cmp = a.position - b.position;
          break;
        case 'created_at':
          cmp = a.created_at.localeCompare(b.created_at);
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [
    tasks,
    filterColumn,
    filterPriority,
    filterAssignee,
    sortKey,
    sortDir,
    columnMap,
  ]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !newTaskColumn) return;
    const colTasks = tasks.filter((t) => t.column_id === newTaskColumn);
    const maxPos =
      colTasks.length > 0
        ? Math.max(...colTasks.map((t) => t.position)) + 1
        : 0;
    try {
      await api.createTask(spaceId, board.id, {
        column_id: newTaskColumn,
        title: newTaskTitle.trim(),
        position: maxPos,
      });
      setNewTaskTitle('');
      setAddingTask(false);
      onRefresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Filters */}
      <div className='flex items-center gap-2 px-4 py-2 border-b border-divider text-xs'>
        <FontAwesomeIcon icon={faFilter} className='text-default-400' />
        <select
          value={filterColumn}
          onChange={(e) => setFilterColumn(e.target.value)}
          className='px-2 py-1 rounded bg-content2 border border-divider text-xs'
        >
          <option value='all'>All columns</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className='px-2 py-1 rounded bg-content2 border border-divider text-xs'
        >
          <option value='all'>All priorities</option>
          <option value='critical'>Critical</option>
          <option value='high'>High</option>
          <option value='medium'>Medium</option>
          <option value='low'>Low</option>
        </select>
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className='px-2 py-1 rounded bg-content2 border border-divider text-xs'
        >
          <option value='all'>All assignees</option>
          {allAssignees.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <span className='text-default-400 ml-auto'>
          {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
        </span>
        {canEdit && (
          <Button
            size='sm'
            color='primary'
            className='h-6 text-xs'
            startContent={
              <FontAwesomeIcon icon={faPlus} className='text-[10px]' />
            }
            onPress={() => setAddingTask(true)}
          >
            Add
          </Button>
        )}
      </div>

      {/* Table */}
      <div className='flex-1 overflow-auto'>
        <table className='w-full text-sm'>
          <thead className='sticky top-0 bg-content1 border-b border-divider'>
            <tr>
              <th
                className='text-left px-4 py-2 text-xs font-semibold text-default-500 cursor-pointer select-none'
                onClick={() => toggleSort('title')}
              >
                Title{' '}
                <SortIcon col='title' sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th
                className='text-left px-3 py-2 text-xs font-semibold text-default-500 cursor-pointer select-none w-28'
                onClick={() => toggleSort('column')}
              >
                Status{' '}
                <SortIcon col='column' sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th
                className='text-left px-3 py-2 text-xs font-semibold text-default-500 cursor-pointer select-none w-24'
                onClick={() => toggleSort('priority')}
              >
                Priority{' '}
                <SortIcon col='priority' sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className='text-left px-3 py-2 text-xs font-semibold text-default-500 w-32'>
                Assignees
              </th>
              <th
                className='text-left px-3 py-2 text-xs font-semibold text-default-500 cursor-pointer select-none w-28'
                onClick={() => toggleSort('due_date')}
              >
                Due Date{' '}
                <SortIcon col='due_date' sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className='text-left px-3 py-2 text-xs font-semibold text-default-500 w-24'>
                Labels
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Inline add task row */}
            {addingTask && (
              <tr className='border-b border-divider bg-content2/50'>
                <td className='px-4 py-2'>
                  <input
                    type='text'
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder='Task title...'
                    className='w-full px-2 py-1 rounded bg-content1 border border-divider text-sm'
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTask();
                      if (e.key === 'Escape') setAddingTask(false);
                    }}
                  />
                </td>
                <td className='px-3 py-2'>
                  <select
                    value={newTaskColumn}
                    onChange={(e) => setNewTaskColumn(e.target.value)}
                    className='w-full px-2 py-1 rounded bg-content1 border border-divider text-xs'
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td colSpan={4} className='px-3 py-2'>
                  <div className='flex gap-1'>
                    <Button
                      size='sm'
                      color='primary'
                      className='h-6 text-xs'
                      onPress={handleAddTask}
                    >
                      Add
                    </Button>
                    <Button
                      size='sm'
                      variant='flat'
                      className='h-6 text-xs'
                      onPress={() => setAddingTask(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </td>
              </tr>
            )}

            {filteredTasks.map((task) => {
              const isOverdue =
                task.due_date && parseDate(task.due_date) < new Date();
              return (
                <tr
                  key={task.id}
                  onClick={() => onTaskClick(task.id)}
                  className='border-b border-divider/50 hover:bg-content2/50 cursor-pointer transition-colors'
                >
                  <td className='px-4 py-2.5'>
                    <span className='font-medium text-foreground'>
                      {task.title}
                    </span>
                  </td>
                  <td className='px-3 py-2.5'>
                    <span className='text-xs px-2 py-0.5 rounded-full bg-default-100 text-default-600'>
                      {columnMap[task.column_id]?.name || '—'}
                    </span>
                  </td>
                  <td className='px-3 py-2.5'>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                        PRIORITY_BADGE[task.priority] || ''
                      }`}
                    >
                      {task.priority}
                    </span>
                  </td>
                  <td className='px-3 py-2.5'>
                    <div className='flex -space-x-1'>
                      {task.assignees?.slice(0, 3).map((a) => (
                        <div
                          key={a.user_id}
                          className='w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold border border-content1'
                          title={a.display_name || a.username}
                        >
                          {(a.display_name || a.username)[0].toUpperCase()}
                        </div>
                      ))}
                      {(task.assignees?.length ?? 0) > 3 && (
                        <span className='text-xs text-default-400 ml-1'>
                          +{(task.assignees?.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className='px-3 py-2.5'>
                    {task.due_date ? (
                      <span
                        className={`text-xs ${
                          isOverdue
                            ? 'text-danger font-medium'
                            : 'text-default-500'
                        }`}
                      >
                        {parseDate(task.due_date).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className='text-xs text-default-300'>—</span>
                    )}
                  </td>
                  <td className='px-3 py-2.5'>
                    <div className='flex flex-wrap gap-1'>
                      {task.labels?.slice(0, 2).map((l) => (
                        <span
                          key={l.id}
                          className='text-[10px] px-1.5 py-0.5 rounded-full'
                          style={{
                            backgroundColor: l.color ? `${l.color}20` : '#8884',
                            color: l.color || '#888',
                          }}
                        >
                          {l.name}
                        </span>
                      ))}
                      {(task.labels?.length ?? 0) > 2 && (
                        <span className='text-[10px] text-default-400'>
                          +{(task.labels?.length ?? 0) - 2}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredTasks.length === 0 && (
          <div className='text-center py-12 text-default-400 text-sm'>
            No tasks found
          </div>
        )}
      </div>
    </div>
  );
}
