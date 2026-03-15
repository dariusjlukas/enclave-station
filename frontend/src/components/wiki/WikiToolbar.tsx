import { useId } from 'react';
import { Button } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBold,
  faItalic,
  faUnderline,
  faStrikethrough,
  faHighlighter,
  faHeading,
  faList,
  faListOl,
  faSquareCheck,
  faCode,
  faQuoteLeft,
  faMinus,
  faTableCells,
  faImage,
  faVideo,
  faLink,
  faAlignLeft,
  faAlignCenter,
  faAlignRight,
  faFileCode,
} from '@fortawesome/free-solid-svg-icons';
import type { Editor } from '@tiptap/react';
import * as api from '../../services/api';

interface Props {
  editor: Editor | null;
  spaceId: string;
  onToggleSource?: () => void;
}

export function WikiToolbar({ editor, spaceId, onToggleSource }: Props) {
  const fileInputId = useId();
  const videoInputId = useId();

  if (!editor) return null;

  const triggerFileInput = () => {
    (document.getElementById(fileInputId) as HTMLInputElement)?.click();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await api.uploadWikiMedia(spaceId, file);
      const url = api.getWikiMediaUrl(result.url, true);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      console.error('Failed to upload image:', err);
    }
    e.target.value = '';
  };

  const triggerVideoInput = () => {
    (document.getElementById(videoInputId) as HTMLInputElement)?.click();
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await api.uploadWikiMedia(spaceId, file);
      const url = api.getWikiMediaUrl(result.url, true);
      editor.commands.setVideo({ src: url });
    } catch (err) {
      console.error('Failed to upload video:', err);
    }
    e.target.value = '';
  };

  const handleLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL:', previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };

  const handleInsertTable = () => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  type ToolbarButton = {
    key: string;
    icon?: typeof faBold;
    label: string;
    action: () => void;
    isActive?: boolean;
    textContent?: string;
  };

  const groups: ToolbarButton[][] = [
    // Text formatting
    [
      {
        key: 'bold',
        icon: faBold,
        label: 'Bold',
        action: () => editor.chain().focus().toggleBold().run(),
        isActive: editor.isActive('bold'),
      },
      {
        key: 'italic',
        icon: faItalic,
        label: 'Italic',
        action: () => editor.chain().focus().toggleItalic().run(),
        isActive: editor.isActive('italic'),
      },
      {
        key: 'underline',
        icon: faUnderline,
        label: 'Underline',
        action: () => editor.chain().focus().toggleUnderline().run(),
        isActive: editor.isActive('underline'),
      },
      {
        key: 'strike',
        icon: faStrikethrough,
        label: 'Strikethrough',
        action: () => editor.chain().focus().toggleStrike().run(),
        isActive: editor.isActive('strike'),
      },
      {
        key: 'highlight',
        icon: faHighlighter,
        label: 'Highlight',
        action: () => editor.chain().focus().toggleHighlight().run(),
        isActive: editor.isActive('highlight'),
      },
    ],
    // Headings
    [
      {
        key: 'h1',
        icon: faHeading,
        label: 'Heading 1',
        action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: editor.isActive('heading', { level: 1 }),
        textContent: '1',
      },
      {
        key: 'h2',
        icon: faHeading,
        label: 'Heading 2',
        action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: editor.isActive('heading', { level: 2 }),
        textContent: '2',
      },
      {
        key: 'h3',
        icon: faHeading,
        label: 'Heading 3',
        action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: editor.isActive('heading', { level: 3 }),
        textContent: '3',
      },
    ],
    // Lists
    [
      {
        key: 'bulletList',
        icon: faList,
        label: 'Bullet List',
        action: () => editor.chain().focus().toggleBulletList().run(),
        isActive: editor.isActive('bulletList'),
      },
      {
        key: 'orderedList',
        icon: faListOl,
        label: 'Numbered List',
        action: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: editor.isActive('orderedList'),
      },
      {
        key: 'taskList',
        icon: faSquareCheck,
        label: 'Task List',
        action: () => editor.chain().focus().toggleTaskList().run(),
        isActive: editor.isActive('taskList'),
      },
    ],
    // Blocks
    [
      {
        key: 'codeBlock',
        icon: faCode,
        label: 'Code Block',
        action: () => editor.chain().focus().toggleCodeBlock().run(),
        isActive: editor.isActive('codeBlock'),
      },
      {
        key: 'blockquote',
        icon: faQuoteLeft,
        label: 'Blockquote',
        action: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: editor.isActive('blockquote'),
      },
      {
        key: 'hr',
        icon: faMinus,
        label: 'Horizontal Rule',
        action: () => editor.chain().focus().setHorizontalRule().run(),
      },
    ],
    // Tables
    [
      {
        key: 'table',
        icon: faTableCells,
        label: 'Insert Table',
        action: handleInsertTable,
      },
    ],
    // Media
    [
      {
        key: 'image',
        icon: faImage,
        label: 'Upload Image',
        action: triggerFileInput,
      },
      {
        key: 'video',
        icon: faVideo,
        label: 'Upload Video',
        action: triggerVideoInput,
      },
      {
        key: 'link',
        icon: faLink,
        label: 'Link',
        action: handleLink,
        isActive: editor.isActive('link'),
      },
    ],
    // Alignment
    [
      {
        key: 'alignLeft',
        icon: faAlignLeft,
        label: 'Align Left',
        action: () => editor.chain().focus().setTextAlign('left').run(),
        isActive: editor.isActive({ textAlign: 'left' }),
      },
      {
        key: 'alignCenter',
        icon: faAlignCenter,
        label: 'Align Center',
        action: () => editor.chain().focus().setTextAlign('center').run(),
        isActive: editor.isActive({ textAlign: 'center' }),
      },
      {
        key: 'alignRight',
        icon: faAlignRight,
        label: 'Align Right',
        action: () => editor.chain().focus().setTextAlign('right').run(),
        isActive: editor.isActive({ textAlign: 'right' }),
      },
    ],
  ];

  return (
    <div className='flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-divider bg-content2/50'>
      {groups.map((group, gi) => (
        <div key={gi} className='flex items-center gap-0.5'>
          {gi > 0 && <div className='w-px h-5 bg-divider mx-1 shrink-0' />}
          {group.map((btn) => (
            <Button
              key={btn.key}
              isIconOnly
              variant='light'
              size='sm'
              aria-label={btn.label}
              title={btn.label}
              className={
                btn.isActive ? 'bg-primary/20 text-primary' : 'text-default-500'
              }
              onPress={btn.action}
            >
              {btn.textContent ? (
                <span className='flex items-center gap-0'>
                  <FontAwesomeIcon icon={btn.icon!} className='text-xs' />
                  <span className='text-[10px] font-bold -ml-0.5'>
                    {btn.textContent}
                  </span>
                </span>
              ) : (
                <FontAwesomeIcon icon={btn.icon!} className='text-sm' />
              )}
            </Button>
          ))}
        </div>
      ))}

      {/* Source toggle */}
      {onToggleSource && (
        <>
          <div className='w-px h-5 bg-divider mx-1 shrink-0' />
          <Button
            isIconOnly
            size='sm'
            variant='light'
            title='Edit Markdown Source'
            onPress={onToggleSource}
          >
            <FontAwesomeIcon icon={faFileCode} className='text-sm' />
          </Button>
        </>
      )}

      {/* Hidden file input for image upload */}
      <input
        id={fileInputId}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={handleImageUpload}
      />
      {/* Hidden file input for video upload */}
      <input
        id={videoInputId}
        type='file'
        accept='video/*'
        className='hidden'
        onChange={handleVideoUpload}
      />
    </div>
  );
}
