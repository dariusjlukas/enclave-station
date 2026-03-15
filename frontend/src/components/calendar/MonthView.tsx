import { useState, useRef, useEffect } from 'react';
import type { CalendarEvent } from '../../types';

const HOVER_MAP: Record<string, string> = {
  blue: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  red: 'bg-red-500/20 text-red-700 dark:text-red-300',
  green: 'bg-green-500/20 text-green-700 dark:text-green-300',
  purple: 'bg-purple-500/20 text-purple-700 dark:text-purple-300',
  orange: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  pink: 'bg-pink-500/20 text-pink-700 dark:text-pink-300',
  yellow: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  teal: 'bg-teal-500/20 text-teal-700 dark:text-teal-300',
};

interface Props {
  events: CalendarEvent[];
  currentDate: Date;
  onDayClick: (date: Date) => void;
  onDayRangeSelect: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

interface SpanSegment {
  event: CalendarEvent;
  startCol: number;
  span: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function isDayInRange(day: Date, rangeStart: Date, rangeEnd: Date): boolean {
  const s = new Date(
    rangeStart.getFullYear(),
    rangeStart.getMonth(),
    rangeStart.getDate(),
  ).getTime();
  const e = new Date(
    rangeEnd.getFullYear(),
    rangeEnd.getMonth(),
    rangeEnd.getDate(),
  ).getTime();
  const min = Math.min(s, e);
  const max = Math.max(s, e);
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
  ).getTime();
  return dayStart >= min && dayStart <= max;
}

/** Strip time component, return midnight */
function dayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Calendar days between two dates (b - a) */
function daysBetween(a: Date, b: Date): number {
  return Math.round((dayOf(b).getTime() - dayOf(a).getTime()) / 86400000);
}

/** Height of each spanning-event lane in px */
const LANE_H = 20;
/** px from cell top to the first spanning lane (p-1=4 + h-6=24 + mb-0.5=2) */
const SPAN_TOP = 30;

function computeWeekSpans(
  week: Date[],
  allEvents: CalendarEvent[],
): SpanSegment[] {
  const weekStart = dayOf(week[0]);
  const weekEnd = dayOf(week[6]);

  // Collect multi-day events that overlap this week
  const spanning: CalendarEvent[] = [];
  for (const ev of allEvents) {
    const evStart = dayOf(new Date(ev.start_time));
    const evEnd = dayOf(new Date(ev.end_time));
    if (isSameDay(evStart, evEnd)) continue;
    if (evEnd < weekStart || evStart > weekEnd) continue;
    spanning.push(ev);
  }

  // Sort: earlier start first, then longer events first (for stable lane assignment)
  spanning.sort((a, b) => {
    const aStart = dayOf(new Date(a.start_time)).getTime();
    const bStart = dayOf(new Date(b.start_time)).getTime();
    if (aStart !== bStart) return aStart - bStart;
    const aDur = daysBetween(new Date(a.start_time), new Date(a.end_time));
    const bDur = daysBetween(new Date(b.start_time), new Date(b.end_time));
    return bDur - aDur;
  });

  const segments: SpanSegment[] = [];
  const lanesUsed: boolean[][] = [];

  for (const ev of spanning) {
    const evStart = dayOf(new Date(ev.start_time));
    const evEnd = dayOf(new Date(ev.end_time));

    // Clamp to week boundaries
    const segStart = evStart < weekStart ? 0 : daysBetween(weekStart, evStart);
    const segEnd = evEnd > weekEnd ? 6 : daysBetween(weekStart, evEnd);
    const span = segEnd - segStart + 1;

    // Find lowest available lane
    let lane = 0;
    while (true) {
      if (!lanesUsed[lane]) lanesUsed[lane] = new Array(7).fill(false);
      let fits = true;
      for (let c = segStart; c <= segEnd; c++) {
        if (lanesUsed[lane][c]) {
          fits = false;
          break;
        }
      }
      if (fits) break;
      lane++;
    }

    if (!lanesUsed[lane]) lanesUsed[lane] = new Array(7).fill(false);
    for (let c = segStart; c <= segEnd; c++) {
      lanesUsed[lane][c] = true;
    }

    segments.push({
      event: ev,
      startCol: segStart,
      span,
      lane,
      isStart: evStart.getTime() >= weekStart.getTime(),
      isEnd: evEnd.getTime() <= weekEnd.getTime(),
    });
  }

  return segments;
}

export function MonthView({
  events,
  currentDate,
  onDayClick,
  onDayRangeSelect,
  onEventClick,
}: Props) {
  const today = new Date();
  const [dragStart, setDragStart] = useState<Date | null>(null);
  const [dragEnd, setDragEnd] = useState<Date | null>(null);
  const [dragging, setDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<Date | null>(null);
  const dragEndRef = useRef<Date | null>(null);

  // Listen for mouseup globally so drag ends even if mouse leaves the grid
  useEffect(() => {
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setDragging(false);

      const start = dragStartRef.current;
      const end = dragEndRef.current;
      dragStartRef.current = null;
      dragEndRef.current = null;
      setDragStart(null);
      setDragEnd(null);

      if (!start || !end) return;

      const s = dayOf(start).getTime();
      const e = dayOf(end).getTime();

      if (s === e) {
        onDayClick(start);
      } else {
        onDayRangeSelect(s < e ? start : end, s < e ? end : start);
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onDayClick, onDayRangeSelect]);

  const month = currentDate.getMonth();
  const year = currentDate.getFullYear();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);

  // Build grid of weeks
  const weeks = (() => {
    const result: Date[][] = [];
    let ws = startOfWeek(monthStart);

    while (ws <= monthEnd || result.length < 5) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setDate(d.getDate() + i);
        week.push(d);
      }
      result.push(week);
      ws = new Date(ws);
      ws.setDate(ws.getDate() + 7);
      if (result.length >= 6) break;
    }
    return result;
  })();

  // Index single-day events by day key (multi-day events are rendered as spanning bars)
  const singleEventsByDay = (() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const start = new Date(ev.start_time);
      const end = new Date(ev.end_time);
      if (!isSameDay(start, end)) continue;
      const key = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
      const list = map.get(key) || [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  })();

  // Compute spanning segments for each week row
  const weekSpans = weeks.map((week) => computeWeekSpans(week, events));

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className='flex flex-col h-full'>
      {/* Day headers */}
      <div className='grid grid-cols-7 border-b border-default-200'>
        {dayNames.map((name) => (
          <div
            key={name}
            className='text-center text-xs font-medium text-default-500 py-2'
          >
            {name}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className='flex-1 grid auto-rows-[minmax(100px,1fr)]'>
        {weeks.map((week, wi) => {
          const spans = weekSpans[wi];
          const numLanes = spans.reduce(
            (max, s) => Math.max(max, s.lane + 1),
            0,
          );
          const maxSingleDay = Math.max(0, 3 - numLanes);

          return (
            <div
              key={wi}
              className='relative grid grid-cols-7 border-b border-default-100'
            >
              {/* Day cells */}
              {week.map((day) => {
                const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                const dayEvents = singleEventsByDay.get(key) || [];
                const isCurrentMonth =
                  day.getMonth() === currentDate.getMonth();
                const isToday = isSameDay(day, today);
                const inDragRange =
                  dragStart && dragEnd && dragging
                    ? isDayInRange(day, dragStart, dragEnd)
                    : false;

                return (
                  <div
                    key={key}
                    className={`border-r border-default-100 last:border-r-0 p-1 cursor-pointer hover:bg-content2/50 transition-colors select-none ${
                      !isCurrentMonth ? 'opacity-40' : ''
                    } ${inDragRange ? 'bg-primary/15' : ''}`}
                    onMouseDown={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return;
                      e.preventDefault();
                      isDraggingRef.current = true;
                      setDragging(true);
                      dragStartRef.current = day;
                      dragEndRef.current = day;
                      setDragStart(day);
                      setDragEnd(day);
                    }}
                    onMouseEnter={() => {
                      if (isDraggingRef.current) {
                        dragEndRef.current = day;
                        setDragEnd(day);
                      }
                    }}
                  >
                    {/* Date number */}
                    <div
                      className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-primary text-white' : 'text-default-600'
                      }`}
                    >
                      {day.getDate()}
                    </div>

                    {/* Spacer to push single-day events below spanning bars */}
                    {numLanes > 0 && (
                      <div style={{ height: numLanes * LANE_H }} />
                    )}

                    {/* Single-day events */}
                    <div className='space-y-0.5'>
                      {dayEvents.slice(0, maxSingleDay).map((ev, i) => (
                        <button
                          key={`${ev.id}-${i}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick(ev);
                          }}
                          className={`relative z-10 w-full text-left text-[11px] leading-tight px-1 py-0.5 rounded truncate ${
                            HOVER_MAP[ev.color] || HOVER_MAP.blue
                          }`}
                        >
                          {!ev.all_day && (
                            <span className='font-medium mr-0.5'>
                              {new Date(ev.start_time).toLocaleTimeString(
                                undefined,
                                { hour: 'numeric', minute: '2-digit' },
                              )}
                            </span>
                          )}
                          {ev.title}
                        </button>
                      ))}
                      {dayEvents.length > maxSingleDay && (
                        <p className='text-[10px] text-default-400 px-1'>
                          +{dayEvents.length - maxSingleDay} more
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Spanning event bars (absolutely positioned across columns) */}
              {spans.map((seg) => {
                const colorCls = HOVER_MAP[seg.event.color] || HOVER_MAP.blue;
                const roundL = seg.isStart ? 'rounded-l' : '';
                const roundR = seg.isEnd ? 'rounded-r' : '';

                return (
                  <button
                    key={`span-${seg.event.id}-${seg.startCol}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(seg.event);
                    }}
                    className={`absolute z-20 text-[11px] leading-tight truncate px-1.5 ${colorCls} ${roundL} ${roundR}`}
                    style={{
                      top: SPAN_TOP + seg.lane * LANE_H,
                      left: `calc(${(seg.startCol / 7) * 100}% + 2px)`,
                      width: `calc(${(seg.span / 7) * 100}% - 4px)`,
                      height: LANE_H - 2,
                      lineHeight: `${LANE_H - 2}px`,
                    }}
                  >
                    {seg.event.title}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
