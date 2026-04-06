import { useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faFolderOpen,
  faFile,
  faChevronRight,
  faChevronDown,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { v86Manager, type VmFileEntry } from '../../services/v86Manager';
import { useSandboxStore } from '../../stores/sandboxStore';

interface Props {
  onRefresh?: () => void;
}

interface TreeNode {
  entry: VmFileEntry;
  path: string;
  children: TreeNode[] | null; // null = not loaded
  expanded: boolean;
}

export function SandboxFileTree({ onRefresh }: Props) {
  const fileTreeRoot = useSandboxStore((s) => s.fileTreeRoot);
  const openFileAction = useSandboxStore((s) => s.openFile);
  const activeFilePath = useSandboxStore((s) => s.activeFilePath);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadDir = useCallback((path: string): TreeNode[] => {
    const entries = v86Manager.listDirectory(path);
    return entries.map((entry) => ({
      entry,
      path: path === '/' ? '/' + entry.name : path + '/' + entry.name,
      children: entry.isDirectory ? null : undefined,
      expanded: false,
    })) as TreeNode[];
  }, []);

  const refresh = useCallback(() => {
    setTree(loadDir(fileTreeRoot));
    setLoaded(true);
    onRefresh?.();
  }, [fileTreeRoot, loadDir, onRefresh]);

  // Load tree on first render
  if (!loaded) {
    const entries = loadDir(fileTreeRoot);
    if (entries.length > 0 || v86Manager.getState() === 'running') {
      setTree(entries);
      setLoaded(true);
    }
  }

  const toggleDir = useCallback(
    (path: string) => {
      setTree((prev) => {
        const update = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map((node) => {
            if (node.path === path && node.entry.isDirectory) {
              if (node.expanded) {
                return { ...node, expanded: false };
              }
              const children = loadDir(node.path);
              return { ...node, expanded: true, children };
            }
            if (node.children && node.expanded) {
              return { ...node, children: update(node.children) };
            }
            return node;
          });
        return update(prev);
      });
    },
    [loadDir],
  );

  const handleFileClick = useCallback(
    async (path: string) => {
      try {
        const data = await v86Manager.readFile(path);
        const decoder = new TextDecoder('utf-8', { fatal: true });
        try {
          const content = decoder.decode(data);
          openFileAction(path, content);
        } catch {
          openFileAction(path, '[Binary file — cannot display]');
        }
      } catch (err) {
        console.error('Failed to read file:', err);
      }
    },
    [openFileAction],
  );

  const renderNode = (node: TreeNode, depth: number) => {
    const isDir = node.entry.isDirectory;
    const isActive = node.path === activeFilePath;
    const paddingLeft = 8 + depth * 16;

    return (
      <div key={node.path}>
        <button
          className={`w-full text-left flex items-center gap-1.5 py-1 text-xs cursor-pointer transition-colors ${
            isActive
              ? 'bg-primary/20 text-primary'
              : 'text-default-400 hover:bg-content2/50 hover:text-foreground'
          }`}
          style={{ paddingLeft }}
          onClick={() => {
            if (isDir) {
              toggleDir(node.path);
            } else {
              handleFileClick(node.path);
            }
          }}
        >
          {isDir && (
            <FontAwesomeIcon
              icon={node.expanded ? faChevronDown : faChevronRight}
              className='text-[8px] w-2'
            />
          )}
          {!isDir && <span className='w-2' />}
          <FontAwesomeIcon
            icon={isDir ? (node.expanded ? faFolderOpen : faFolder) : faFile}
            className={`text-[10px] ${isDir ? 'text-warning/70' : 'text-default-400'}`}
          />
          <span className='truncate'>{node.entry.name}</span>
        </button>
        {isDir && node.expanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className='flex flex-col h-full bg-[#16162a]'>
      <div className='flex items-center justify-between px-2 py-1.5 border-b border-default-200 flex-shrink-0'>
        <span className='text-[10px] text-default-500 font-semibold uppercase tracking-wider truncate'>
          {fileTreeRoot}
        </span>
        <button
          onClick={refresh}
          className='text-default-400 hover:text-foreground cursor-pointer p-0.5'
          title='Refresh'
        >
          <FontAwesomeIcon icon={faRotateRight} className='text-[10px]' />
        </button>
      </div>
      <div className='flex-1 overflow-auto py-1'>
        {tree.length === 0 ? (
          <div className='px-2 py-4 text-[10px] text-default-500 text-center'>
            {loaded ? 'No files' : 'Loading...'}
          </div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}
