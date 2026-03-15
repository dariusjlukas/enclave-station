import { useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendar } from '@fortawesome/free-solid-svg-icons';
import type { TaskItem, TaskLabel } from '../../types';

interface Props {
  task: TaskItem;
  boardLabels: TaskLabel[];
  onClick: () => void;
  canDrag: boolean;
}

const PRIORITY_BORDER: Record<string, string> = {
  critical: 'border-l-danger',
  high: 'border-l-warning',
  medium: 'border-l-primary',
  low: 'border-l-default-300',
};

function parseDate(s: string): Date {
  let iso = s.replace(' ', 'T');
  iso = iso.replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso);
}

export function TaskCard({ task, onClick, canDrag }: Props) {
  const now = useMemo(() => new Date(), []);
  const isOverdue = task.due_date && parseDate(task.due_date) < now;
  const isDueSoon =
    task.due_date &&
    !isOverdue &&
    parseDate(task.due_date).getTime() - now.getTime() < 86400000 * 2;

  return (
    <div
      onClick={onClick}
      className={`rounded-lg bg-content1 border border-divider hover:border-primary/50 transition-all cursor-pointer border-l-3 ${
        PRIORITY_BORDER[task.priority] || 'border-l-default-300'
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className='p-3'>
        {/* Labels */}
        {task.labels && task.labels.length > 0 && (
          <div className='flex flex-wrap gap-1 mb-2'>
            {task.labels.map((label) => (
              <span
                key={label.id}
                className='text-[10px] px-1.5 py-0.5 rounded-full font-medium'
                style={{
                  backgroundColor: label.color ? `${label.color}20` : '#8884',
                  color: label.color || '#888',
                }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <h4 className='text-sm font-medium text-foreground leading-snug'>
          {task.title}
        </h4>

        {/* Meta row */}
        <div className='flex items-center gap-2 mt-2 flex-wrap'>
          {/* Due date */}
          {task.due_date && (
            <span
              className={`text-[11px] flex items-center gap-1 ${
                isOverdue
                  ? 'text-danger'
                  : isDueSoon
                    ? 'text-warning'
                    : 'text-default-400'
              }`}
            >
              <FontAwesomeIcon icon={faCalendar} className='text-[9px]' />
              {parseDate(task.due_date).toLocaleDateString()}
            </span>
          )}

          {/* Assignees */}
          {task.assignees && task.assignees.length > 0 && (
            <div className='flex -space-x-1 ml-auto'>
              {task.assignees.slice(0, 3).map((a) => (
                <div
                  key={a.user_id}
                  className='w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold border border-content1'
                  title={a.display_name || a.username}
                >
                  {(a.display_name || a.username)[0].toUpperCase()}
                </div>
              ))}
              {task.assignees.length > 3 && (
                <div className='w-5 h-5 rounded-full bg-default-100 text-default-500 flex items-center justify-center text-[9px] font-bold border border-content1'>
                  +{task.assignees.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
