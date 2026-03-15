import { useState, useMemo, useRef, useCallback } from 'react';

function parseDate(s: string): Date {
  // PostgreSQL timestamptz::text uses space separator and +00 offset (no colon)
  // Normalize to ISO 8601: replace space with T, ensure +HH:MM format
  let iso = s.replace(' ', 'T');
  // Fix bare timezone offset like +00 or -05 → +00:00 or -05:00
  iso = iso.replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso);
}
import { Button } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMagnifyingGlassMinus,
  faMagnifyingGlassPlus,
} from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type {
  TaskBoard,
  TaskItem,
  TaskColumn,
  TaskDependency,
} from '../../types';

interface Props {
  spaceId: string;
  board: TaskBoard;
  columns: TaskColumn[];
  tasks: TaskItem[];
  dependencies: TaskDependency[];
  canEdit: boolean;
  onTaskClick: (taskId: string) => void;
  onRefresh: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#3b82f6',
  low: '#94a3b8',
};

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 50;
const LEFT_PANEL_WIDTH = 260;

type ZoomLevel = 'day' | 'week' | 'month';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function GanttChart({
  spaceId,
  board,
  columns,
  tasks,
  dependencies,
  canEdit,
  onTaskClick,
  onRefresh,
}: Props) {
  const [zoom, setZoom] = useState<ZoomLevel>('day');
  const [addingDep, setAddingDep] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag state for moving/resizing bars
  const dragStartX = useRef(0);
  const dragOrigStart = useRef('');
  const dragOrigDuration = useRef(0);
  const didDrag = useRef(false);
  const autoScrollRAF = useRef<number>(0);
  const lastMouseX = useRef(0);
  const [dragInfo, setDragInfo] = useState<{
    taskId: string;
    type: 'move' | 'resize';
    dx: number;
  } | null>(null);

  const cellWidth = zoom === 'day' ? 32 : zoom === 'week' ? 100 : 120;

  const columnMap = useMemo(() => {
    const m: Record<string, TaskColumn> = {};
    columns.forEach((c) => (m[c.id] = c));
    return m;
  }, [columns]);

  // Sort tasks by column position then task position
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const colA = columnMap[a.column_id]?.position ?? 0;
      const colB = columnMap[b.column_id]?.position ?? 0;
      if (colA !== colB) return colA - colB;
      return a.position - b.position;
    });
  }, [tasks, columnMap]);

  // Compute date range from all tasks
  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let minDate = new Date(now);
    let maxDate = addDays(now, 14);

    for (const t of tasks) {
      if (t.start_date) {
        const s = parseDate(t.start_date);
        s.setHours(0, 0, 0, 0);
        if (s < minDate) minDate = new Date(s);
        const end = addDays(s, Math.max(t.duration_days || 1, 1));
        if (end > maxDate) maxDate = new Date(end);
      }
      if (t.due_date) {
        const d = parseDate(t.due_date);
        d.setHours(0, 0, 0, 0);
        if (d > maxDate) maxDate = new Date(d);
        if (d < minDate) minDate = new Date(d);
      }
    }

    // Pad range
    minDate = addDays(minDate, -3);
    maxDate = addDays(maxDate, 7);

    return {
      rangeStart: minDate,
      rangeEnd: maxDate,
      totalDays: daysBetween(minDate, maxDate),
    };
  }, [tasks]);

  // Generate date header labels
  const dateHeaders = useMemo(() => {
    const headers: { label: string; width: number; date: Date }[] = [];
    if (zoom === 'day') {
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(rangeStart, i);
        headers.push({
          label: d.getDate().toString(),
          width: cellWidth,
          date: d,
        });
      }
    } else if (zoom === 'week') {
      let d = new Date(rangeStart);
      while (d < rangeEnd) {
        headers.push({
          label: `${formatDate(d)}`,
          width: cellWidth,
          date: new Date(d),
        });
        d = addDays(d, 7);
      }
    } else {
      let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      while (d < rangeEnd) {
        headers.push({
          label: d.toLocaleDateString(undefined, {
            month: 'short',
            year: '2-digit',
          }),
          width: cellWidth,
          date: new Date(d),
        });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    }
    return headers;
  }, [rangeStart, rangeEnd, totalDays, zoom, cellWidth]);

  const timelineWidth =
    zoom === 'day' ? totalDays * cellWidth : dateHeaders.length * cellWidth;

  // Convert a date to X position
  const dateToX = useCallback(
    (date: Date): number => {
      const days = daysBetween(rangeStart, date);
      if (zoom === 'day') return days * cellWidth;
      if (zoom === 'week') return (days / 7) * cellWidth;
      // month: approximate
      const months =
        (date.getFullYear() - rangeStart.getFullYear()) * 12 +
        (date.getMonth() - rangeStart.getMonth()) +
        date.getDate() / 30;
      const rangeMonths = dateHeaders.length > 0 ? dateHeaders.length : 1;
      return (months / rangeMonths) * timelineWidth;
    },
    [rangeStart, zoom, cellWidth, dateHeaders, timelineWidth],
  );

  const durationToWidth = useCallback(
    (days: number): number => {
      if (zoom === 'day') return Math.max(days * cellWidth, cellWidth);
      if (zoom === 'week') return Math.max((days / 7) * cellWidth, 14);
      return Math.max((days / 30) * cellWidth, 14);
    },
    [zoom, cellWidth],
  );

  // Auto-scroll the timeline when dragging near edges.
  // Reads lastMouseX ref each frame so it always uses the latest cursor position.
  const startAutoScroll = () => {
    cancelAnimationFrame(autoScrollRAF.current);

    const tick = () => {
      const el = scrollRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const edgeZone = 60;
      const maxSpeed = 14;
      const mx = lastMouseX.current;

      const distFromLeft = mx - rect.left;
      const distFromRight = rect.right - mx;

      if (distFromLeft < edgeZone && el.scrollLeft > 0) {
        const speed = Math.round(
          maxSpeed * (1 - Math.max(0, distFromLeft) / edgeZone),
        );
        el.scrollLeft -= speed;
      } else if (
        distFromRight < edgeZone &&
        el.scrollLeft < el.scrollWidth - el.clientWidth
      ) {
        const speed = Math.round(
          maxSpeed * (1 - Math.max(0, distFromRight) / edgeZone),
        );
        el.scrollLeft += speed;
      }

      autoScrollRAF.current = requestAnimationFrame(tick);
    };
    autoScrollRAF.current = requestAnimationFrame(tick);
  };

  const stopAutoScroll = () => {
    cancelAnimationFrame(autoScrollRAF.current);
  };

  // Drag handlers for moving/resizing bars
  const handleBarMouseDown = (
    e: React.MouseEvent,
    taskId: string,
    type: 'move' | 'resize',
    task: TaskItem,
  ) => {
    if (!canEdit) return;
    e.stopPropagation();
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragOrigStart.current = task.start_date;
    dragOrigDuration.current = task.duration_days || 1;
    didDrag.current = false;

    const onMouseMove = (me: MouseEvent) => {
      didDrag.current = true;
      lastMouseX.current = me.clientX;
      const dx = me.clientX - dragStartX.current;
      setDragInfo({ taskId, type, dx });
    };

    lastMouseX.current = e.clientX;
    startAutoScroll();

    const onMouseUp = async (me: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      stopAutoScroll();

      const dx = me.clientX - dragStartX.current;
      const daysDelta = Math.round(
        (dx / cellWidth) * (zoom === 'day' ? 1 : zoom === 'week' ? 7 : 30),
      );

      if (!didDrag.current || daysDelta === 0) {
        setDragInfo(null);
        return;
      }

      // Keep drag visual until refresh completes to avoid flicker
      try {
        if (type === 'move' && dragOrigStart.current) {
          const origDate = parseDate(dragOrigStart.current);
          const newDate = addDays(origDate, daysDelta);
          await api.updateTask(spaceId, board.id, taskId, {
            start_date: newDate.toISOString(),
          });
        } else if (type === 'resize') {
          const newDuration = Math.max(1, dragOrigDuration.current + daysDelta);
          await api.updateTask(spaceId, board.id, taskId, {
            duration_days: newDuration,
          });
        }
        await onRefresh();
      } catch {
        // ignore
      }
      setDragInfo(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Add dependency flow
  const handleBarClick = async (taskId: string) => {
    if (addingDep && addingDep !== taskId) {
      try {
        await api.addTaskDependency(spaceId, board.id, {
          task_id: taskId,
          depends_on_id: addingDep,
        });
        setAddingDep(null);
        onRefresh();
      } catch {
        // ignore
      }
    } else {
      onTaskClick(taskId);
    }
  };

  const handleRemoveDep = async (depId: string) => {
    try {
      await api.removeTaskDependency(spaceId, board.id, depId);
      onRefresh();
    } catch {
      // ignore
    }
  };

  // Click-drag on the date header to pan the timeline
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    const startX = e.clientX;
    const startScroll = el.scrollLeft;

    const onMove = (me: MouseEvent) => {
      el.scrollLeft = startScroll - (me.clientX - startX);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.style.cursor = '';
    };
    el.style.cursor = 'grabbing';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Build task index for dependency arrows
  const taskIndex = useMemo(() => {
    const m: Record<string, number> = {};
    sortedTasks.forEach((t, i) => (m[t.id] = i));
    return m;
  }, [sortedTasks]);

  const chartHeight = sortedTasks.length * ROW_HEIGHT;

  // Month header row for day zoom
  const monthHeaders = useMemo(() => {
    if (zoom !== 'day') return [];
    const result: { label: string; x: number; width: number }[] = [];
    let curMonth = -1;
    let startIdx = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i);
      const m = d.getMonth();
      if (m !== curMonth) {
        if (curMonth >= 0) {
          result.push({
            label: addDays(rangeStart, startIdx).toLocaleDateString(undefined, {
              month: 'short',
              year: 'numeric',
            }),
            x: startIdx * cellWidth,
            width: (i - startIdx) * cellWidth,
          });
        }
        curMonth = m;
        startIdx = i;
      }
    }
    // Last month
    if (curMonth >= 0) {
      result.push({
        label: addDays(rangeStart, startIdx).toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        }),
        x: startIdx * cellWidth,
        width: (totalDays - startIdx) * cellWidth,
      });
    }
    return result;
  }, [zoom, totalDays, rangeStart, cellWidth]);

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Toolbar */}
      <div className='flex items-center gap-2 px-4 py-2 border-b border-divider text-xs'>
        <div className='flex items-center gap-1'>
          <Button
            isIconOnly
            variant='light'
            size='sm'
            className='h-6 w-6 min-w-0'
            onPress={() =>
              setZoom((z) =>
                z === 'day' ? 'day' : z === 'week' ? 'day' : 'week',
              )
            }
            title='Zoom in'
          >
            <FontAwesomeIcon icon={faMagnifyingGlassPlus} className='text-xs' />
          </Button>
          <span className='text-default-500 capitalize px-1'>{zoom}</span>
          <Button
            isIconOnly
            variant='light'
            size='sm'
            className='h-6 w-6 min-w-0'
            onPress={() =>
              setZoom((z) =>
                z === 'month' ? 'month' : z === 'day' ? 'week' : 'month',
              )
            }
            title='Zoom out'
          >
            <FontAwesomeIcon
              icon={faMagnifyingGlassMinus}
              className='text-xs'
            />
          </Button>
        </div>

        {canEdit && (
          <>
            <div className='h-4 border-l border-divider mx-1' />
            {addingDep ? (
              <div className='flex items-center gap-1'>
                <span className='text-warning'>
                  Click a task to set as dependent...
                </span>
                <Button
                  size='sm'
                  variant='flat'
                  className='h-5 text-[10px]'
                  onPress={() => setAddingDep(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <span className='text-default-400'>
                Drag bars to reschedule. Right-click a bar to add dependencies.
              </span>
            )}
          </>
        )}

        <span className='text-default-400 ml-auto'>
          {sortedTasks.length} task{sortedTasks.length !== 1 ? 's' : ''}
          {dependencies.length > 0 &&
            ` / ${dependencies.length} dep${dependencies.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Chart */}
      <div className='flex-1 flex overflow-hidden'>
        {/* Left panel: task names */}
        <div
          className='shrink-0 border-r border-divider overflow-y-auto'
          style={{ width: LEFT_PANEL_WIDTH }}
        >
          {/* Header spacer */}
          <div
            className='border-b border-divider bg-content2/50 px-3 flex items-center text-xs font-semibold text-default-500'
            style={{ height: HEADER_HEIGHT }}
          >
            Task
          </div>
          {sortedTasks.map((task) => (
            <div
              key={task.id}
              className='flex items-center px-3 border-b border-divider/30 hover:bg-content2/30 cursor-pointer transition-colors gap-2'
              style={{ height: ROW_HEIGHT }}
              onClick={() => handleBarClick(task.id)}
            >
              <span
                className='w-1.5 h-1.5 rounded-full shrink-0'
                style={{
                  backgroundColor: PRIORITY_COLORS[task.priority] || '#94a3b8',
                }}
              />
              <span className='text-xs truncate text-foreground'>
                {task.title}
              </span>
              <span className='text-[10px] text-default-300 ml-auto shrink-0'>
                {columnMap[task.column_id]?.name}
              </span>
            </div>
          ))}
        </div>

        {/* Right panel: timeline */}
        <div ref={scrollRef} className='flex-1 overflow-auto'>
          <div style={{ minWidth: timelineWidth, position: 'relative' }}>
            {/* Date headers — click-drag to pan */}
            <div
              className='sticky top-0 z-10 bg-content1 border-b border-divider flex flex-col cursor-grab active:cursor-grabbing select-none'
              style={{ height: HEADER_HEIGHT }}
              onMouseDown={handleHeaderMouseDown}
            >
              {/* Month row for day zoom */}
              {monthHeaders.length > 0 && (
                <div className='flex' style={{ height: 22 }}>
                  {monthHeaders.map((mh, i) => (
                    <div
                      key={i}
                      className='text-[10px] text-default-500 font-semibold px-1 border-r border-divider/30 flex items-center'
                      style={{ width: mh.width, minWidth: mh.width }}
                    >
                      {mh.label}
                    </div>
                  ))}
                </div>
              )}
              <div className='flex flex-1'>
                {dateHeaders.map((h, i) => {
                  const isToday =
                    zoom === 'day' &&
                    h.date.toDateString() === new Date().toDateString();
                  const isWeekend =
                    zoom === 'day' &&
                    (h.date.getDay() === 0 || h.date.getDay() === 6);
                  return (
                    <div
                      key={i}
                      className={`text-[10px] text-center border-r border-divider/30 flex items-center justify-center ${
                        isToday
                          ? 'bg-primary/10 text-primary font-bold'
                          : isWeekend
                            ? 'text-default-300'
                            : 'text-default-500'
                      }`}
                      style={{ width: h.width, minWidth: h.width }}
                    >
                      {h.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Task rows + bars */}
            <div style={{ position: 'relative', height: chartHeight }}>
              {/* Grid lines */}
              {dateHeaders.map((h, i) => {
                const isToday =
                  zoom === 'day' &&
                  h.date.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={i}
                    className={`absolute top-0 border-r ${
                      isToday ? 'border-primary/30' : 'border-divider/20'
                    }`}
                    style={{
                      left: i * h.width + h.width,
                      height: chartHeight,
                    }}
                  />
                );
              })}

              {/* Today line */}
              {zoom === 'day' &&
                (() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const x = dateToX(today);
                  if (x >= 0 && x <= timelineWidth) {
                    return (
                      <div
                        className='absolute top-0 w-0.5 bg-primary/60 z-5'
                        style={{ left: x, height: chartHeight }}
                      />
                    );
                  }
                  return null;
                })()}

              {/* Row backgrounds */}
              {sortedTasks.map((_, i) => (
                <div
                  key={i}
                  className={`absolute w-full border-b border-divider/20 ${
                    i % 2 === 0 ? '' : 'bg-content2/20'
                  }`}
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                />
              ))}

              {/* Task bars */}
              {sortedTasks.map((task, rowIdx) => {
                if (!task.start_date) {
                  // Show a small marker at due_date if no start_date
                  if (task.due_date) {
                    const dueX = dateToX(parseDate(task.due_date));
                    return (
                      <div
                        key={task.id}
                        className='absolute flex items-center'
                        style={{
                          left: dueX - 4,
                          top: rowIdx * ROW_HEIGHT + 8,
                          height: ROW_HEIGHT - 16,
                        }}
                      >
                        <div
                          className='w-2 h-2 rotate-45 cursor-pointer'
                          style={{
                            backgroundColor:
                              PRIORITY_COLORS[task.priority] || '#94a3b8',
                          }}
                          onClick={() => handleBarClick(task.id)}
                          title={`${task.title} (due ${parseDate(task.due_date).toLocaleDateString()})`}
                        />
                      </div>
                    );
                  }
                  return null;
                }

                let startX = dateToX(parseDate(task.start_date));
                let barWidth = durationToWidth(task.duration_days || 1);
                const barColor = PRIORITY_COLORS[task.priority] || '#94a3b8';
                const isDragging = dragInfo?.taskId === task.id;

                // Apply live drag offset
                if (isDragging) {
                  if (dragInfo.type === 'move') {
                    startX += dragInfo.dx;
                  } else if (dragInfo.type === 'resize') {
                    barWidth = Math.max(cellWidth, barWidth + dragInfo.dx);
                  }
                }

                return (
                  <div
                    key={task.id}
                    className={`absolute flex items-center group ${isDragging ? 'z-10' : ''}`}
                    style={{
                      left: startX,
                      top: rowIdx * ROW_HEIGHT + 6,
                      width: barWidth,
                      height: ROW_HEIGHT - 12,
                      opacity: isDragging ? 0.85 : 1,
                    }}
                  >
                    {/* Bar */}
                    <div
                      className='h-full w-full rounded cursor-pointer relative overflow-hidden'
                      style={{ backgroundColor: `${barColor}30` }}
                      onClick={() => {
                        if (!didDrag.current) handleBarClick(task.id);
                      }}
                      onMouseDown={(e) => {
                        if (e.button === 0)
                          handleBarMouseDown(e, task.id, 'move', task);
                      }}
                      onContextMenu={(e) => {
                        if (!canEdit) return;
                        e.preventDefault();
                        setAddingDep(task.id);
                      }}
                      title={`${task.title}\nStarts: ${parseDate(task.start_date).toLocaleDateString()}${task.duration_days ? ` (${task.duration_days}d)` : ''}`}
                    >
                      {/* Fill bar */}
                      <div
                        className='h-full rounded'
                        style={{
                          backgroundColor: barColor,
                          opacity: 0.7,
                          width: '100%',
                        }}
                      />
                      {/* Label */}
                      {barWidth > 50 && (
                        <span className='absolute inset-0 flex items-center px-1.5 text-[10px] text-white font-medium truncate pointer-events-none'>
                          {task.title}
                        </span>
                      )}
                    </div>

                    {/* Resize handle (outside overflow-hidden bar so always reachable) */}
                    {canEdit && (
                      <div
                        className='absolute right-0 top-0 h-full w-2.5 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r'
                        style={{ backgroundColor: barColor }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleBarMouseDown(e, task.id, 'resize', task);
                        }}
                      />
                    )}

                    {/* Due date marker */}
                    {task.due_date &&
                      (() => {
                        const dueX = dateToX(parseDate(task.due_date)) - startX;
                        if (dueX >= 0) {
                          return (
                            <div
                              className='absolute top-0 w-0.5 bg-danger pointer-events-none'
                              style={{
                                left: dueX,
                                height: ROW_HEIGHT - 12 + 6,
                                top: -3,
                              }}
                              title={`Due: ${parseDate(task.due_date).toLocaleDateString()}`}
                            />
                          );
                        }
                        return null;
                      })()}
                  </div>
                );
              })}

              {/* Dependency arrows (SVG overlay) */}
              <svg
                ref={svgRef}
                className='absolute top-0 left-0 pointer-events-none'
                style={{ width: timelineWidth, height: chartHeight }}
              >
                <defs>
                  <marker
                    id='arrowhead'
                    markerWidth='8'
                    markerHeight='6'
                    refX='8'
                    refY='3'
                    orient='auto'
                  >
                    <polygon
                      points='0 0, 8 3, 0 6'
                      className='fill-default-400'
                    />
                  </marker>
                </defs>
                {dependencies.map((dep) => {
                  const fromTask = sortedTasks.find(
                    (t) => t.id === dep.depends_on_id,
                  );
                  const toTask = sortedTasks.find((t) => t.id === dep.task_id);
                  if (!fromTask?.start_date || !toTask?.start_date) return null;

                  const fromIdx = taskIndex[dep.depends_on_id];
                  const toIdx = taskIndex[dep.task_id];
                  if (fromIdx === undefined || toIdx === undefined) return null;

                  const fromX =
                    dateToX(parseDate(fromTask.start_date)) +
                    durationToWidth(fromTask.duration_days || 1);
                  const fromY = fromIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const toX = dateToX(parseDate(toTask.start_date));
                  const toY = toIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

                  // Simple path: horizontal out, then vertical, then horizontal in
                  const midX = Math.max(fromX + 12, (fromX + toX) / 2);

                  return (
                    <g key={dep.id} className='pointer-events-auto'>
                      <path
                        d={`M ${fromX} ${fromY}
                            L ${midX} ${fromY}
                            L ${midX} ${toY}
                            L ${toX} ${toY}`}
                        fill='none'
                        className='stroke-default-400'
                        strokeWidth='1.5'
                        markerEnd='url(#arrowhead)'
                      />
                      {canEdit && (
                        <circle
                          cx={midX}
                          cy={(fromY + toY) / 2}
                          r='6'
                          className='fill-danger/0 hover:fill-danger/80 cursor-pointer transition-colors'
                          onClick={() => handleRemoveDep(dep.id)}
                        >
                          <title>Remove dependency</title>
                        </circle>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
