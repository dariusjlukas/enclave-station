import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Markdown } from 'tiptap-markdown';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Video } from './VideoExtension';
import type { WikiPage } from '../../types';
import * as api from '../../services/api';
import { WikiToolbar } from './WikiToolbar';
import './WikiEditorStyles.css';

const lowlight = createLowlight(common);

function getEditorMarkdown(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown?.getMarkdown?.() ?? '';
}

interface Props {
  spaceId: string;
  page: WikiPage;
  canEdit: boolean;
  onSave?: (page: WikiPage) => void;
  flushSaveRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

export function WikiPageEditor({
  spaceId,
  page,
  canEdit,
  onSave,
  flushSaveRef,
}: Props) {
  const [title, setTitle] = useState(page.title);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const pageRef = useRef(page);
  const titleRef = useRef(title);

  // Keep refs in sync
  pageRef.current = page;
  titleRef.current = title;

  // Reset title when page changes
  useEffect(() => {
    setTitle(page.title);
    setSourceMode(false);
  }, [page.id, page.title]);

  const getMarkdown = useCallback(
    (): string => {
      if (!editor) return pageRef.current.content || '';
      return (
        (getEditorMarkdown(editor) as string) ?? pageRef.current.content ?? ''
      );
    }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const doSave = useCallback(
    async (markdown: string, titleToSave: string) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      try {
        const updated = await api.updateWikiPage(spaceId, pageRef.current.id, {
          title: titleToSave,
          content: markdown,
        });
        onSave?.(updated);
      } catch (err) {
        console.error('Failed to save wiki page:', err);
      } finally {
        isSavingRef.current = false;
      }
    },
    [spaceId, onSave],
  );

  const scheduleSave = useCallback(
    (markdown: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        doSave(markdown, titleRef.current);
      }, 2000);
    },
    [doSave],
  );

  // Expose a flush function so the parent can force-save before creating a version
  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const md = getMarkdown();
    await doSave(md, titleRef.current);
  }, [getMarkdown, doSave]);

  useEffect(() => {
    if (flushSaveRef) flushSaveRef.current = flushSave;
    return () => {
      if (flushSaveRef) flushSaveRef.current = null;
    };
  }, [flushSaveRef, flushSave]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          link: false,
          underline: false,
        }),
        Markdown.configure({
          html: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
        Underline,
        Link.configure({
          autolink: true,
          openOnClick: true,
        }),
        Image.configure({
          inline: false,
        }),
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableCell,
        TableHeader,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        Highlight,
        TextAlign.configure({
          types: ['heading', 'paragraph'],
        }),
        Placeholder.configure({
          placeholder: 'Start writing...',
        }),
        CodeBlockLowlight.configure({
          lowlight,
        }),
        Video,
      ],
      content: page.content || undefined,
      editable: canEdit,
      onUpdate: ({ editor: ed }) => {
        if (!canEdit) return;
        const md =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((ed.storage as any).markdown?.getMarkdown?.() as string) ?? '';
        scheduleSave(md);
      },
      editorProps: {
        handleDrop: (view, event) => {
          if (!canEdit) return false;
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;

          const imageFile = Array.from(files).find((f) =>
            f.type.startsWith('image/'),
          );
          if (!imageFile) return false;

          event.preventDefault();
          api
            .uploadWikiMedia(spaceId, imageFile)
            .then((result) => {
              const url = api.getWikiMediaUrl(result.url, true);
              const { tr } = view.state;
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (pos) {
                const node = view.state.schema.nodes.image.create({
                  src: url,
                });
                view.dispatch(tr.insert(pos.pos, node));
              }
            })
            .catch((err) =>
              console.error('Failed to upload dropped image:', err),
            );
          return true;
        },
        handlePaste: (view, event) => {
          if (!canEdit) return false;
          const items = event.clipboardData?.items;
          if (!items) return false;

          const imageItem = Array.from(items).find((item) =>
            item.type.startsWith('image/'),
          );
          if (!imageItem) return false;

          const file = imageItem.getAsFile();
          if (!file) return false;

          event.preventDefault();
          api
            .uploadWikiMedia(spaceId, file)
            .then((result) => {
              const url = api.getWikiMediaUrl(result.url, true);
              const { tr, selection } = view.state;
              const node = view.state.schema.nodes.image.create({
                src: url,
              });
              view.dispatch(tr.insert(selection.from, node));
            })
            .catch((err) =>
              console.error('Failed to upload pasted image:', err),
            );
          return true;
        },
      },
    },
    [page.id],
  );

  // Update editable state when canEdit changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(canEdit && !sourceMode);
    }
  }, [editor, canEdit, sourceMode]);

  // Switch to source mode: grab markdown from editor
  const enterSourceMode = useCallback(() => {
    setSourceText(getMarkdown());
    setSourceMode(true);
  }, [getMarkdown]);

  // Switch back to WYSIWYG: push markdown into editor
  const exitSourceMode = useCallback(() => {
    if (editor) {
      editor.commands.setContent(sourceText);
      // Trigger save with the edited markdown
      scheduleSave(sourceText);
    }
    setSourceMode(false);
  }, [editor, sourceText, scheduleSave]);

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== pageRef.current.title && canEdit) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const md = sourceMode ? sourceText : getMarkdown();
      doSave(md, trimmed);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      if (!sourceMode) editor?.commands.focus();
    }
  };

  return (
    <div className='wiki-editor flex flex-col h-full'>
      {/* Inline editable title */}
      {canEdit ? (
        <input
          type='text'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          className='text-3xl font-bold bg-transparent border-none outline-none px-4 pt-4 pb-2 w-full placeholder-default-300'
          placeholder='Untitled'
        />
      ) : (
        <h1 className='text-3xl font-bold px-4 pt-4 pb-2'>{page.title}</h1>
      )}

      {/* Toolbar (only when editing in WYSIWYG mode) */}
      {canEdit && !sourceMode && (
        <WikiToolbar
          editor={editor}
          spaceId={spaceId}
          onToggleSource={enterSourceMode}
        />
      )}

      {/* Source mode toolbar */}
      {canEdit && sourceMode && (
        <div className='flex items-center gap-2 px-2 py-1.5 border-b border-divider bg-content2/50'>
          <span className='text-xs text-default-400 font-mono px-2'>
            Markdown Source
          </span>
          <div className='flex-1' />
          <button
            onClick={exitSourceMode}
            className='text-xs text-primary hover:text-primary-600 font-medium px-2 py-1 rounded hover:bg-primary/10 transition-colors'
          >
            Back to WYSIWYG
          </button>
        </div>
      )}

      {/* Content area */}
      <div className='flex-1 flex flex-col min-h-0'>
        {sourceMode ? (
          <textarea
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              scheduleSave(e.target.value);
            }}
            className='flex-1 w-full bg-transparent font-mono text-sm p-4 outline-none resize-none leading-relaxed'
            placeholder='Write Markdown here...'
            spellCheck={false}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    </div>
  );
}
