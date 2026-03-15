import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  Button,
  Spinner,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTrash,
  faPlus,
  faXmark,
  faCheck,
  faSquare,
  faSquareCheck,
  faUser,
  faTag,
  faListCheck,
} from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type {
  TaskItem,
  TaskColumn,
  TaskLabel,
  TaskChecklistItem,
} from '../../types';
import { useChatStore } from '../../stores/chatStore';

function parseDate(s: string): Date {
  let iso = s.replace(' ', 'T');
  iso = iso.replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso);
}

interface Props {
  spaceId: string;
  boardId: string;
  taskId: string;
  columns: TaskColumn[];
  boardLabels: TaskLabel[];
  canEdit: boolean;
  spaceMembers: { id: string; username: string; display_name: string }[];
  onClose: () => void;
  onUpdate: () => void;
}

export function TaskDetailModal({
  spaceId,
  boardId,
  taskId,
  columns,
  boardLabels,
  canEdit,
  onClose,
  onUpdate,
}: Props) {
  const [task, setTask] = useState<TaskItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [durationDays, setDurationDays] = useState(0);
  const [columnId, setColumnId] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);

  // Checklist state
  const [addingChecklist, setAddingChecklist] = useState(false);
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [addingItemTo, setAddingItemTo] = useState<string | null>(null);
  const [newItemContent, setNewItemContent] = useState('');

  // Label state
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#3b82f6');

  // Assignee state
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);

  // Get space members from store
  const spaces = useChatStore((s) => s.spaces);
  const space = spaces.find((s) => s.id === spaceId);
  const members = space?.members || [];

  const loadTask = useCallback(async () => {
    try {
      const t = await api.getTaskDetail(spaceId, boardId, taskId);
      setTask(t);
      setTitle(t.title);
      setDescription(t.description);
      setPriority(t.priority);
      setDueDate(t.due_date ? t.due_date.split(/[T ]/)[0] : '');
      setStartDate(t.start_date ? t.start_date.split(/[T ]/)[0] : '');
      setDurationDays(t.duration_days || 0);
      setColumnId(t.column_id);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [spaceId, boardId, taskId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const saveField = async (
    field: string,
    value: string | string[] | number,
  ) => {
    try {
      const updated = await api.updateTask(spaceId, boardId, taskId, {
        [field]: value,
      });
      setTask((prev) => (prev ? { ...prev, ...updated } : null));
      onUpdate();
    } catch {
      // ignore
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.deleteTask(spaceId, boardId, taskId);
      onUpdate();
      onClose();
    } catch {
      // ignore
    }
  };

  // Checklist handlers
  const handleAddChecklist = async () => {
    if (!newChecklistTitle.trim()) return;
    try {
      await api.createTaskChecklist(spaceId, boardId, taskId, {
        title: newChecklistTitle.trim(),
        position: task?.checklists?.length || 0,
      });
      setNewChecklistTitle('');
      setAddingChecklist(false);
      loadTask();
    } catch {
      // ignore
    }
  };

  const handleDeleteChecklist = async (checklistId: string) => {
    try {
      await api.deleteTaskChecklist(spaceId, boardId, taskId, checklistId);
      loadTask();
    } catch {
      // ignore
    }
  };

  const handleAddItem = async (checklistId: string) => {
    if (!newItemContent.trim()) return;
    try {
      await api.createChecklistItem(spaceId, boardId, taskId, checklistId, {
        content: newItemContent.trim(),
        position: 0,
      });
      setNewItemContent('');
      setAddingItemTo(null);
      loadTask();
    } catch {
      // ignore
    }
  };

  const handleToggleItem = async (
    checklistId: string,
    item: TaskChecklistItem,
  ) => {
    try {
      await api.updateChecklistItem(
        spaceId,
        boardId,
        taskId,
        checklistId,
        item.id,
        { content: item.content, is_checked: !item.is_checked },
      );
      loadTask();
    } catch {
      // ignore
    }
  };

  const handleDeleteItem = async (checklistId: string, itemId: string) => {
    try {
      await api.deleteChecklistItem(
        spaceId,
        boardId,
        taskId,
        checklistId,
        itemId,
      );
      loadTask();
    } catch {
      // ignore
    }
  };

  // Assignee handlers
  const handleToggleAssignee = async (userId: string) => {
    if (!task) return;
    const current = task.assignees?.map((a) => a.user_id) || [];
    const newIds = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    await saveField('assignee_ids', newIds);
    loadTask();
  };

  // Label handlers
  const handleToggleLabel = async (labelId: string) => {
    if (!task) return;
    const current = task.labels?.map((l) => l.id) || [];
    const newIds = current.includes(labelId)
      ? current.filter((id) => id !== labelId)
      : [...current, labelId];
    await saveField('label_ids', newIds);
    loadTask();
  };

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;
    try {
      await api.createTaskLabel(spaceId, boardId, {
        name: newLabelName.trim(),
        color: newLabelColor,
      });
      setNewLabelName('');
      onUpdate();
    } catch {
      // ignore
    }
  };

  const formatActivityDetail = (action: string, details: string) => {
    try {
      const d = JSON.parse(details);
      switch (action) {
        case 'created':
          return `created this task`;
        case 'moved': {
          const from =
            columns.find((c) => c.id === d.column?.from)?.name || '?';
          const to = columns.find((c) => c.id === d.column?.to)?.name || '?';
          return `moved from ${from} to ${to}`;
        }
        case 'updated': {
          const parts: string[] = [];
          if (d.title) parts.push(`title`);
          if (d.priority) parts.push(`priority to ${d.priority.to}`);
          if (d.due_date) parts.push(`due date`);
          return `updated ${parts.join(', ') || 'task'}`;
        }
        case 'checklist_added':
          return `added checklist "${d.title}"`;
        default:
          return action;
      }
    } catch {
      return action;
    }
  };

  if (loading) {
    return (
      <Modal isOpen onClose={onClose} size='3xl' scrollBehavior='inside'>
        <ModalContent>
          <ModalBody className='flex items-center justify-center py-12'>
            <Spinner size='lg' />
          </ModalBody>
        </ModalContent>
      </Modal>
    );
  }

  if (!task) {
    return (
      <Modal isOpen onClose={onClose} size='3xl'>
        <ModalContent>
          <ModalBody className='text-center py-12 text-default-400'>
            Task not found
          </ModalBody>
        </ModalContent>
      </Modal>
    );
  }

  const assignedIds = new Set(task.assignees?.map((a) => a.user_id) || []);
  const labelIds = new Set(task.labels?.map((l) => l.id) || []);

  return (
    <Modal isOpen onClose={onClose} size='3xl' scrollBehavior='inside'>
      <ModalContent>
        <ModalHeader className='flex items-center justify-between pr-12'>
          {editingTitle ? (
            <input
              type='text'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className='flex-1 px-2 py-1 rounded bg-content2 border border-divider text-lg font-semibold'
              autoFocus
              onBlur={() => {
                if (title.trim() && title !== task.title) {
                  saveField('title', title.trim());
                }
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          ) : (
            <h2
              className={`text-lg font-semibold ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
              onClick={() => canEdit && setEditingTitle(true)}
            >
              {task.title}
            </h2>
          )}
        </ModalHeader>
        <ModalBody className='pb-6'>
          <div className='flex gap-6'>
            {/* Main content */}
            <div className='flex-1 min-w-0 space-y-5'>
              {/* Description */}
              <div>
                <h3 className='text-xs font-semibold text-default-500 uppercase mb-1'>
                  Description
                </h3>
                {editingDesc ? (
                  <div>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm min-h-[100px] resize-y'
                      autoFocus
                    />
                    <div className='flex gap-1 mt-1'>
                      <Button
                        size='sm'
                        color='primary'
                        className='h-7 text-xs'
                        onPress={() => {
                          saveField('description', description);
                          setEditingDesc(false);
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size='sm'
                        variant='flat'
                        className='h-7 text-xs'
                        onPress={() => {
                          setDescription(task.description);
                          setEditingDesc(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`text-sm text-default-600 whitespace-pre-wrap ${
                      canEdit
                        ? 'cursor-pointer hover:bg-content2 rounded-lg p-2 -m-2 transition-colors'
                        : ''
                    } ${!task.description ? 'text-default-300 italic' : ''}`}
                    onClick={() => canEdit && setEditingDesc(true)}
                  >
                    {task.description || 'Add a description...'}
                  </div>
                )}
              </div>

              {/* Checklists */}
              {task.checklists && task.checklists.length > 0 && (
                <div className='space-y-4'>
                  {task.checklists.map((cl) => {
                    const items = cl.items || [];
                    const checked = items.filter((i) => i.is_checked).length;
                    const pct =
                      items.length > 0
                        ? Math.round((checked / items.length) * 100)
                        : 0;

                    return (
                      <div key={cl.id}>
                        <div className='flex items-center justify-between mb-2'>
                          <div className='flex items-center gap-2'>
                            <FontAwesomeIcon
                              icon={faListCheck}
                              className='text-xs text-default-400'
                            />
                            <h4 className='text-sm font-semibold'>
                              {cl.title}
                            </h4>
                            <span className='text-xs text-default-400'>
                              {checked}/{items.length}
                            </span>
                          </div>
                          {canEdit && (
                            <Button
                              isIconOnly
                              variant='light'
                              size='sm'
                              className='h-5 w-5 min-w-0'
                              onPress={() => handleDeleteChecklist(cl.id)}
                            >
                              <FontAwesomeIcon
                                icon={faTrash}
                                className='text-[10px] text-danger'
                              />
                            </Button>
                          )}
                        </div>

                        {/* Progress bar */}
                        {items.length > 0 && (
                          <div className='h-1.5 rounded-full bg-default-100 mb-2'>
                            <div
                              className='h-full rounded-full bg-success transition-all'
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}

                        {/* Items */}
                        <div className='space-y-1'>
                          {items.map((item) => (
                            <div
                              key={item.id}
                              className='flex items-center gap-2 group px-1'
                            >
                              <button
                                onClick={() =>
                                  canEdit && handleToggleItem(cl.id, item)
                                }
                                className={`shrink-0 ${canEdit ? 'cursor-pointer' : ''}`}
                              >
                                <FontAwesomeIcon
                                  icon={
                                    item.is_checked ? faSquareCheck : faSquare
                                  }
                                  className={`text-sm ${
                                    item.is_checked
                                      ? 'text-success'
                                      : 'text-default-300'
                                  }`}
                                />
                              </button>
                              <span
                                className={`text-sm flex-1 ${
                                  item.is_checked
                                    ? 'line-through text-default-300'
                                    : ''
                                }`}
                              >
                                {item.content}
                              </span>
                              {canEdit && (
                                <button
                                  onClick={() =>
                                    handleDeleteItem(cl.id, item.id)
                                  }
                                  className='opacity-0 group-hover:opacity-100 transition-opacity'
                                >
                                  <FontAwesomeIcon
                                    icon={faXmark}
                                    className='text-xs text-default-300 hover:text-danger'
                                  />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Add item */}
                        {canEdit &&
                          (addingItemTo === cl.id ? (
                            <div className='flex items-center gap-1 mt-1'>
                              <input
                                type='text'
                                value={newItemContent}
                                onChange={(e) =>
                                  setNewItemContent(e.target.value)
                                }
                                placeholder='Add an item...'
                                className='flex-1 px-2 py-1 rounded bg-content2 border border-divider text-sm'
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddItem(cl.id);
                                  if (e.key === 'Escape') setAddingItemTo(null);
                                }}
                              />
                              <Button
                                size='sm'
                                color='primary'
                                className='h-7 text-xs min-w-0'
                                onPress={() => handleAddItem(cl.id)}
                              >
                                Add
                              </Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setAddingItemTo(cl.id);
                                setNewItemContent('');
                              }}
                              className='text-xs text-default-400 hover:text-foreground mt-1 flex items-center gap-1'
                            >
                              <FontAwesomeIcon
                                icon={faPlus}
                                className='text-[10px]'
                              />
                              Add item
                            </button>
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add checklist button */}
              {canEdit && (
                <div>
                  {addingChecklist ? (
                    <div className='flex items-center gap-1'>
                      <input
                        type='text'
                        value={newChecklistTitle}
                        onChange={(e) => setNewChecklistTitle(e.target.value)}
                        placeholder='Checklist name...'
                        className='flex-1 px-2 py-1.5 rounded bg-content2 border border-divider text-sm'
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddChecklist();
                          if (e.key === 'Escape') setAddingChecklist(false);
                        }}
                      />
                      <Button
                        size='sm'
                        color='primary'
                        className='h-7 text-xs'
                        onPress={handleAddChecklist}
                      >
                        Add
                      </Button>
                      <Button
                        size='sm'
                        variant='flat'
                        className='h-7 text-xs'
                        onPress={() => setAddingChecklist(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size='sm'
                      variant='flat'
                      startContent={
                        <FontAwesomeIcon
                          icon={faListCheck}
                          className='text-xs'
                        />
                      }
                      onPress={() => setAddingChecklist(true)}
                    >
                      Add Checklist
                    </Button>
                  )}
                </div>
              )}

              {/* Activity */}
              {task.activity && task.activity.length > 0 && (
                <div>
                  <h3 className='text-xs font-semibold text-default-500 uppercase mb-2'>
                    Activity
                  </h3>
                  <div className='space-y-2'>
                    {task.activity.map((act) => (
                      <div
                        key={act.id}
                        className='flex items-start gap-2 text-xs'
                      >
                        <div className='w-5 h-5 rounded-full bg-default-100 text-default-500 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5'>
                          {(act.display_name ||
                            act.username ||
                            '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <span className='font-medium'>
                            {act.display_name || act.username}
                          </span>{' '}
                          <span className='text-default-400'>
                            {formatActivityDetail(act.action, act.details)}
                          </span>
                          <div className='text-[10px] text-default-300 mt-0.5'>
                            {parseDate(act.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className='w-48 shrink-0 space-y-4'>
              {/* Status */}
              <div>
                <h4 className='text-xs font-semibold text-default-500 uppercase mb-1'>
                  Status
                </h4>
                <select
                  value={columnId}
                  onChange={(e) => {
                    setColumnId(e.target.value);
                    saveField('column_id', e.target.value);
                  }}
                  className='w-full px-2 py-1.5 rounded bg-content2 border border-divider text-sm'
                  disabled={!canEdit}
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <h4 className='text-xs font-semibold text-default-500 uppercase mb-1'>
                  Priority
                </h4>
                <select
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value);
                    saveField('priority', e.target.value);
                  }}
                  className='w-full px-2 py-1.5 rounded bg-content2 border border-divider text-sm capitalize'
                  disabled={!canEdit}
                >
                  <option value='critical'>Critical</option>
                  <option value='high'>High</option>
                  <option value='medium'>Medium</option>
                  <option value='low'>Low</option>
                </select>
              </div>

              {/* Due date */}
              <div>
                <h4 className='text-xs font-semibold text-default-500 uppercase mb-1'>
                  Due Date
                </h4>
                <input
                  type='date'
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    saveField(
                      'due_date',
                      e.target.value ? e.target.value + 'T00:00:00Z' : '',
                    );
                  }}
                  className='w-full px-2 py-1.5 rounded bg-content2 border border-divider text-sm'
                  disabled={!canEdit}
                />
              </div>

              {/* Start date */}
              <div>
                <h4 className='text-xs font-semibold text-default-500 uppercase mb-1'>
                  Start Date
                </h4>
                <input
                  type='date'
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    saveField(
                      'start_date',
                      e.target.value ? e.target.value + 'T00:00:00Z' : '',
                    );
                  }}
                  className='w-full px-2 py-1.5 rounded bg-content2 border border-divider text-sm'
                  disabled={!canEdit}
                />
              </div>

              {/* Duration */}
              <div>
                <h4 className='text-xs font-semibold text-default-500 uppercase mb-1'>
                  Duration (days)
                </h4>
                <input
                  type='number'
                  value={durationDays || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setDurationDays(val);
                    saveField('duration_days', val);
                  }}
                  className='w-full px-2 py-1.5 rounded bg-content2 border border-divider text-sm'
                  disabled={!canEdit}
                  min={0}
                  placeholder='0'
                />
              </div>

              {/* Assignees */}
              <div>
                <div className='flex items-center justify-between mb-1'>
                  <h4 className='text-xs font-semibold text-default-500 uppercase'>
                    Assignees
                  </h4>
                  {canEdit && (
                    <button
                      onClick={() => setShowAssigneePicker(!showAssigneePicker)}
                      className='text-xs text-primary'
                    >
                      <FontAwesomeIcon icon={faPlus} />
                    </button>
                  )}
                </div>
                <div className='space-y-1'>
                  {task.assignees?.map((a) => (
                    <div
                      key={a.user_id}
                      className='flex items-center gap-1.5 text-xs group'
                    >
                      <div className='w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold'>
                        {(a.display_name || a.username)[0].toUpperCase()}
                      </div>
                      <span className='truncate'>
                        {a.display_name || a.username}
                      </span>
                      {canEdit && (
                        <button
                          onClick={() => handleToggleAssignee(a.user_id)}
                          className='ml-auto opacity-0 group-hover:opacity-100'
                        >
                          <FontAwesomeIcon
                            icon={faXmark}
                            className='text-[10px] text-default-300 hover:text-danger'
                          />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {showAssigneePicker && (
                  <div className='mt-1 p-2 rounded-lg bg-content2 border border-divider max-h-40 overflow-y-auto'>
                    {members.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleToggleAssignee(m.id)}
                        className='w-full text-left flex items-center gap-2 px-2 py-1 text-xs hover:bg-content3 rounded'
                      >
                        <FontAwesomeIcon
                          icon={assignedIds.has(m.id) ? faCheck : faUser}
                          className={`text-[10px] w-3 ${
                            assignedIds.has(m.id)
                              ? 'text-success'
                              : 'text-default-300'
                          }`}
                        />
                        {m.display_name || m.username}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Labels */}
              <div>
                <div className='flex items-center justify-between mb-1'>
                  <h4 className='text-xs font-semibold text-default-500 uppercase'>
                    Labels
                  </h4>
                  {canEdit && (
                    <button
                      onClick={() => setShowLabelPicker(!showLabelPicker)}
                      className='text-xs text-primary'
                    >
                      <FontAwesomeIcon icon={faPlus} />
                    </button>
                  )}
                </div>
                <div className='flex flex-wrap gap-1'>
                  {task.labels?.map((l) => (
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
                </div>
                {showLabelPicker && (
                  <div className='mt-1 p-2 rounded-lg bg-content2 border border-divider max-h-48 overflow-y-auto'>
                    {boardLabels.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => handleToggleLabel(l.id)}
                        className='w-full text-left flex items-center gap-2 px-2 py-1 text-xs hover:bg-content3 rounded'
                      >
                        <FontAwesomeIcon
                          icon={labelIds.has(l.id) ? faCheck : faTag}
                          className={`text-[10px] w-3 ${
                            labelIds.has(l.id)
                              ? 'text-success'
                              : 'text-default-300'
                          }`}
                        />
                        <span
                          className='w-2.5 h-2.5 rounded-full shrink-0'
                          style={{ backgroundColor: l.color || '#888' }}
                        />
                        {l.name}
                      </button>
                    ))}
                    {/* Create new label inline */}
                    <div className='border-t border-divider mt-1 pt-1'>
                      <div className='flex items-center gap-1'>
                        <input
                          type='color'
                          value={newLabelColor}
                          onChange={(e) => setNewLabelColor(e.target.value)}
                          className='w-5 h-5 rounded cursor-pointer border-0'
                        />
                        <input
                          type='text'
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          placeholder='New label...'
                          className='flex-1 px-1.5 py-0.5 rounded bg-content1 border border-divider text-xs'
                          onKeyDown={(e) =>
                            e.key === 'Enter' && handleCreateLabel()
                          }
                        />
                        <Button
                          size='sm'
                          color='primary'
                          className='h-5 text-[10px] min-w-0 px-2'
                          onPress={handleCreateLabel}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Meta info */}
              <div className='text-[11px] text-default-300 space-y-0.5 pt-2 border-t border-divider'>
                <p>Created by {task.created_by_username}</p>
                <p>{parseDate(task.created_at).toLocaleString()}</p>
              </div>

              {/* Delete */}
              {canEdit && (
                <Button
                  size='sm'
                  color='danger'
                  variant='flat'
                  className='w-full'
                  startContent={
                    <FontAwesomeIcon icon={faTrash} className='text-xs' />
                  }
                  onPress={handleDelete}
                >
                  Delete Task
                </Button>
              )}
            </div>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
