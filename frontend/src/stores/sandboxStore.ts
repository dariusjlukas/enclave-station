import { create } from 'zustand';

type VmState = 'none' | 'booting' | 'running' | 'stopped';

export interface OpenFile {
  path: string;
  content: string;
  savedContent: string;
}

interface SandboxState {
  vmState: VmState;
  ideVisible: boolean;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  fileTreeRoot: string;

  setVmState: (state: VmState) => void;
  setIdeVisible: (visible: boolean) => void;
  openFile: (path: string, content: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileSaved: (path: string, content: string) => void;
  setFileTreeRoot: (root: string) => void;
  clearIdeState: () => void;
}

export const useSandboxStore = create<SandboxState>((set) => ({
  vmState: 'none',
  ideVisible: false,
  openFiles: [],
  activeFilePath: null,
  fileTreeRoot: '/root',

  setVmState: (state) => set({ vmState: state }),

  setIdeVisible: (visible) => set({ ideVisible: visible }),

  openFile: (path, content) =>
    set((s) => {
      const existing = s.openFiles.find((f) => f.path === path);
      if (existing) return { activeFilePath: path };
      return {
        openFiles: [...s.openFiles, { path, content, savedContent: content }],
        activeFilePath: path,
      };
    }),

  closeFile: (path) =>
    set((s) => {
      const files = s.openFiles.filter((f) => f.path !== path);
      const activePath =
        s.activeFilePath === path
          ? (files[files.length - 1]?.path ?? null)
          : s.activeFilePath;
      return { openFiles: files, activeFilePath: activePath };
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content } : f,
      ),
    })),

  markFileSaved: (path, content) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, savedContent: content } : f,
      ),
    })),

  setFileTreeRoot: (root) => set({ fileTreeRoot: root }),

  clearIdeState: () =>
    set({
      openFiles: [],
      activeFilePath: null,
    }),
}));
