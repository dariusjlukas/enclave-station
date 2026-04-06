import { useMemo, useCallback, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { useSandboxStore } from '../../stores/sandboxStore';
import { v86Manager } from '../../services/v86Manager';

interface Props {
  onSaved?: () => void;
}

const LANG_MAP: Record<string, () => Promise<Extension>> = {
  js: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  mjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  ts: () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ typescript: true }),
    ),
  jsx: () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true }),
    ),
  tsx: () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
  c: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cc: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  h: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  hpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  htm: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  md: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  yml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
};

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

export function SandboxCodeEditor({ onSaved }: Props) {
  const activeFilePath = useSandboxStore((s) => s.activeFilePath);
  const openFiles = useSandboxStore((s) => s.openFiles);
  const updateFileContent = useSandboxStore((s) => s.updateFileContent);
  const markFileSaved = useSandboxStore((s) => s.markFileSaved);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const [langForPath, setLangForPath] = useState<string | null>(null);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  // Load language extension when active file changes
  if (activeFilePath !== langForPath) {
    setLangForPath(activeFilePath);
    setLangExtension(null);
    if (activeFilePath) {
      const ext = getExtension(activeFilePath);
      const loader = LANG_MAP[ext];
      if (loader) {
        loader().then(setLangExtension);
      }
    }
  }

  const handleSave = useCallback(async () => {
    if (!activeFile) return;
    const encoder = new TextEncoder();
    const data = encoder.encode(activeFile.content);
    try {
      await v86Manager.createFile(activeFile.path, data.buffer as ArrayBuffer);
      markFileSaved(activeFile.path, activeFile.content);
      onSaved?.();
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [activeFile, markFileSaved, onSaved]);

  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            handleSave();
            return true;
          },
        },
      ]),
    [handleSave],
  );

  const extensions = useMemo(() => {
    const exts: Extension[] = [saveKeymap];
    if (langExtension) exts.push(langExtension);
    return exts;
  }, [saveKeymap, langExtension]);

  if (!activeFile) {
    return (
      <div className='flex-1 flex items-center justify-center text-default-400 text-sm'>
        Select a file to edit
      </div>
    );
  }

  return (
    <CodeMirror
      value={activeFile.content}
      height='100%'
      theme={oneDark}
      extensions={extensions}
      onChange={(value) => updateFileContent(activeFile.path, value)}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        bracketMatching: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        autocompletion: false,
      }}
      className='h-full overflow-hidden'
    />
  );
}
