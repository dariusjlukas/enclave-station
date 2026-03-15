import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBook, faChevronRight } from '@fortawesome/free-solid-svg-icons';

interface BreadcrumbItem {
  id: string;
  name: string;
}

interface Props {
  path: BreadcrumbItem[];
  onNavigate: (pageId: string) => void;
}

export function WikiBreadcrumb({ path, onNavigate }: Props) {
  return (
    <nav className='flex items-center gap-1 text-sm min-w-0 overflow-hidden'>
      <button
        onClick={() => onNavigate('')}
        className='flex items-center gap-1.5 text-default-400 hover:text-foreground transition-colors shrink-0'
      >
        <FontAwesomeIcon icon={faBook} className='text-xs' />
        <span>Wiki</span>
      </button>

      {path.map((item, index) => {
        const isLast = index === path.length - 1;
        return (
          <span key={item.id} className='flex items-center gap-1 min-w-0'>
            <FontAwesomeIcon
              icon={faChevronRight}
              className='text-[10px] text-default-400 shrink-0'
            />
            {isLast ? (
              <span className='text-foreground font-medium truncate'>
                {item.name}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(item.id)}
                className='text-default-400 hover:text-foreground transition-colors truncate'
              >
                {item.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
