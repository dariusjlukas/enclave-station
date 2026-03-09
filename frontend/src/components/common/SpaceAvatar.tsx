import { getAvatarUrl } from '../../services/api';

const DEFAULT_COLORS = [
  '#e53e3e',
  '#dd6b20',
  '#d69e2e',
  '#38a169',
  '#319795',
  '#3182ce',
  '#5a67d8',
  '#805ad5',
  '#d53f8c',
  '#718096',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

interface SpaceAvatarProps {
  name: string;
  avatarFileId?: string;
  profileColor?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: { container: 'w-6 h-6', text: 'text-[10px]' },
  md: { container: 'w-11 h-11', text: 'text-sm' },
  lg: { container: 'w-16 h-16', text: 'text-2xl' },
};

export function SpaceAvatar({
  name,
  avatarFileId,
  profileColor,
  size = 'md',
  className = '',
}: SpaceAvatarProps) {
  const s = sizeMap[size];
  const bgColor =
    profileColor || DEFAULT_COLORS[hashString(name) % DEFAULT_COLORS.length];
  const letter = (name[0] || '?').toUpperCase();

  if (avatarFileId) {
    return (
      <img
        key={avatarFileId}
        src={getAvatarUrl(avatarFileId)}
        alt={name}
        className={`${s.container} rounded-xl object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${s.container} rounded-xl flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      <span className={`${s.text} font-semibold text-white leading-none`}>
        {letter}
      </span>
    </div>
  );
}
