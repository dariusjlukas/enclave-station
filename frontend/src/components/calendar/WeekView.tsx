import type { CalendarEvent } from '../../types';

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-500/80',
  red: 'bg-red-500/80',
  green: 'bg-green-500/80',
  purple: 'bg-purple-500/80',
  orange: 'bg-orange-500/80',
  pink: 'bg-pink-500/80',
  yellow: 'bg-yellow-500/80',
  teal: 'bg-teal-500/80',
};

const ALL_DAY_MAP: Record<string, string> = {
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
  onTimeClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

interface AllDaySegment {
  event: CalendarEvent;
  startCol: number;
  span: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((dayOf(b).getTime() - dayOf(a).getTime()) / 86400000);
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 60;
const LANE_H = 20;

function computeAllDaySegments(
  days: Date[],
  allEvents: CalendarEvent[],
): AllDaySegment[] {
  const weekStart = dayOf(days[0]);
  const weekEnd = dayOf(days[days.length - 1]);
  const numCols = days.length;

  // Collect events for the all-day section: all_day OR multi-day
  const items: {
    ev: CalendarEvent;
    startCol: number;
    span: number;
    isStart: boolean;
    isEnd: boolean;
  }[] = [];

  for (const ev of allEvents) {
    const evStart = dayOf(new Date(ev.start_time));
    const evEnd = dayOf(new Date(ev.end_time));
    const isMultiDay = !isSameDay(evStart, evEnd);
    if (!ev.all_day && !isMultiDay) continue;
    if (evEnd < weekStart || evStart > weekEnd) continue;

    const segStart = evStart < weekStart ? 0 : daysBetween(weekStart, evStart);
    const segEnd =
      evEnd > weekEnd ? numCols - 1 : daysBetween(weekStart, evEnd);

    items.push({
      ev,
      startCol: segStart,
      span: segEnd - segStart + 1,
      isStart: evStart.getTime() >= weekStart.getTime(),
      isEnd: evEnd.getTime() <= weekEnd.getTime(),
    });
  }

  // Sort: earlier start, then longer spans first
  items.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return b.span - a.span;
  });

  const segments: AllDaySegment[] = [];
  const lanesUsed: boolean[][] = [];

  for (const item of items) {
    let lane = 0;
    while (true) {
      if (!lanesUsed[lane]) lanesUsed[lane] = new Array(numCols).fill(false);
      let fits = true;
      for (let c = item.startCol; c < item.startCol + item.span; c++) {
        if (lanesUsed[lane][c]) {
          fits = false;
          break;
        }
      }
      if (fits) break;
      lane++;
    }

    if (!lanesUsed[lane]) lanesUsed[lane] = new Array(numCols).fill(false);
    for (let c = item.startCol; c < item.startCol + item.span; c++) {
      lanesUsed[lane][c] = true;
    }

    segments.push({
      event: item.ev,
      startCol: item.startCol,
      span: item.span,
      lane,
      isStart: item.isStart,
      isEnd: item.isEnd,
    });
  }

  return segments;
}

export function WeekView({
  events,
  currentDate,
  onTimeClick,
  onEventClick,
}: Props) {
  const today = new Date();
  const weekStart = startOfWeek(currentDate);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Single-day timed events go in the time grid; everything else goes in the all-day section
  const timedEvents: CalendarEvent[] = [];
  for (const ev of events) {
    const s = new Date(ev.start_time);
    const e = new Date(ev.end_time);
    if (!ev.all_day && isSameDay(s, e)) {
      timedEvents.push(ev);
    }
  }

  const allDaySegments = computeAllDaySegments(days, events);
  const numLanes = allDaySegments.reduce(
    (max, s) => Math.max(max, s.lane + 1),
    0,
  );

  // Index timed events by day
  const timedByDay = new Map<string, CalendarEvent[]>();
  for (const ev of timedEvents) {
    const start = new Date(ev.start_time);
    const key = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
    const list = timedByDay.get(key) || [];
    list.push(ev);
    timedByDay.set(key, list);
  }

  return (
    <div className='flex flex-col h-full'>
      {/* Scrollable area containing headers, all-day section, and time grid */}
      <div className='flex-1 overflow-y-auto'>
        {/* Sticky header block: day headers + all-day section */}
        <div className='sticky top-0 z-10 bg-background'>
          {/* Day headers */}
          <div className='grid grid-cols-[60px_repeat(7,1fr)] border-b border-default-200'>
            <div />
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.getTime()}
                  className='text-center py-2 border-l border-default-100'
                >
                  <div className='text-xs text-default-400'>
                    {day.toLocaleDateString(undefined, { weekday: 'short' })}
                  </div>
                  <div
                    className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mx-auto ${
                      isToday ? 'bg-primary text-white' : ''
                    }`}
                  >
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* All-day / multi-day events section */}
          {numLanes > 0 && (
            <div className='grid grid-cols-[60px_1fr] border-b border-default-200'>
              <div className='text-xs text-default-400 p-1 text-right pr-2 self-start pt-1.5'>
                All day
              </div>
              <div
                className='relative'
                style={{ minHeight: numLanes * LANE_H + 4 }}
              >
                {/* Column border lines */}
                <div className='absolute inset-0 grid grid-cols-7 pointer-events-none'>
                  {days.map((_, i) => (
                    <div key={i} className='border-l border-default-100' />
                  ))}
                </div>

                {/* Spanning event bars */}
                {allDaySegments.map((seg) => {
                  const colorCls =
                    ALL_DAY_MAP[seg.event.color] || ALL_DAY_MAP.blue;
                  const roundL = seg.isStart ? 'rounded-l' : '';
                  const roundR = seg.isEnd ? 'rounded-r' : '';

                  return (
                    <button
                      key={`span-${seg.event.id}-${seg.startCol}`}
                      onClick={() => onEventClick(seg.event)}
                      className={`absolute z-10 text-[11px] leading-tight truncate px-1.5 ${colorCls} ${roundL} ${roundR}`}
                      style={{
                        top: seg.lane * LANE_H + 2,
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
            </div>
          )}
        </div>

        {/* Time grid */}
        <div className='grid grid-cols-[60px_repeat(7,1fr)] relative'>
          {/* Time labels */}
          <div>
            {HOURS.map((h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className='text-xs text-default-400 text-right pr-2 pt-0 -mt-2 relative'
              >
                {h === 0
                  ? ''
                  : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                    })}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
            const dayEvents = timedByDay.get(key) || [];

            return (
              <div
                key={day.getTime()}
                className='border-l border-default-100 relative'
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    style={{ height: HOUR_HEIGHT }}
                    className='border-b border-default-100 cursor-pointer hover:bg-content2/30'
                    onClick={() => {
                      const d = new Date(day);
                      d.setHours(h);
                      onTimeClick(d);
                    }}
                  />
                ))}

                {/* Event blocks */}
                {dayEvents.map((ev) => {
                  const start = new Date(ev.start_time);
                  const end = new Date(ev.end_time);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  const endMin = end.getHours() * 60 + end.getMinutes();
                  const duration = Math.max(endMin - startMin, 15);
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = (duration / 60) * HOUR_HEIGHT;

                  return (
                    <button
                      key={`${ev.id}-${ev.occurrence_date || ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-white text-[11px] leading-tight overflow-hidden cursor-pointer ${
                        COLOR_MAP[ev.color] || COLOR_MAP.blue
                      }`}
                      style={{
                        top: `${top}px`,
                        height: `${Math.max(height, 18)}px`,
                      }}
                    >
                      <div className='font-medium truncate'>{ev.title}</div>
                      {height > 30 && (
                        <div className='opacity-80 truncate'>
                          {start.toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
