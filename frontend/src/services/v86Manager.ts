type VmState = 'booting' | 'running' | 'stopped';

interface SandboxInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emulator: any;
  state: VmState;
  serialBuffer: string;
  onSerialOutput: ((data: string) => void) | null;
}

type StateChangeCallback = (state: VmState | 'none') => void;

const SERIAL_BUFFER_MAX = 50000;
const SERIAL_BUFFER_TRIM = 40000;

let v86ScriptLoaded = false;
let v86ScriptLoading: Promise<void> | null = null;

function loadV86Script(): Promise<void> {
  if (v86ScriptLoaded) return Promise.resolve();
  if (v86ScriptLoading) return v86ScriptLoading;

  v86ScriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/v86/libv86.js';
    script.onload = () => {
      v86ScriptLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load v86'));
    document.head.appendChild(script);
  });

  return v86ScriptLoading;
}

class V86Manager {
  private instance: SandboxInstance | null = null;
  private onStateChange: StateChangeCallback | null = null;

  setStateChangeCallback(cb: StateChangeCallback) {
    this.onStateChange = cb;
  }

  async start(): Promise<void> {
    if (this.instance) return;

    const instance: SandboxInstance = {
      emulator: null,
      state: 'booting',
      serialBuffer: '',
      onSerialOutput: null,
    };
    this.instance = instance;
    this.onStateChange?.('booting');

    await loadV86Script();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const V86Constructor = (window as any).V86;
    if (!V86Constructor) {
      this.instance = null;
      this.onStateChange?.('none');
      throw new Error('V86 not found on window');
    }

    const emulator = new V86Constructor({
      wasm_path: '/v86/v86.wasm',
      bios: { url: '/v86/seabios.bin' },
      vga_bios: { url: '/v86/vgabios.bin' },
      bzimage: { url: '/v86/vmlinuz-alpine' },
      initrd: { url: '/v86/initramfs-alpine' },
      cmdline: [
        'rw',
        'root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose',
        'console=ttyS0',
        'noapic noacpi nolapic',
        'init=/bin/busybox',
        'init_args=sh',
      ].join(' '),
      filesystem: {
        basefs: '/v86/alpine-basefs.json',
        baseurl: '/v86/alpine-flat/',
      },
      memory_size: 512 * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      autostart: true,
      disable_mouse: true,
      disable_keyboard: true,
      disable_speaker: true,
    });

    instance.emulator = emulator;

    emulator.add_listener('serial0-output-byte', (byte: number) => {
      if (
        byte < 0x07 ||
        (byte > 0x0d && byte < 0x1b) ||
        byte === 0x7f ||
        byte > 0x7e
      ) {
        return;
      }
      const char = String.fromCharCode(byte);
      instance.serialBuffer += char;
      if (instance.serialBuffer.length > SERIAL_BUFFER_MAX) {
        instance.serialBuffer =
          instance.serialBuffer.slice(-SERIAL_BUFFER_TRIM);
      }
      instance.onSerialOutput?.(char);
    });

    emulator.add_listener('emulator-ready', () => {
      instance.state = 'running';
      this.onStateChange?.('running');
    });
  }

  stop(): void {
    if (!this.instance) return;
    this.instance.onSerialOutput = null;
    if (this.instance.emulator) {
      this.instance.emulator.destroy();
    }
    this.instance = null;
    this.onStateChange?.('none');
  }

  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  sendInput(data: string): void {
    if (!this.instance?.emulator) return;
    for (let i = 0; i < data.length; i++) {
      this.instance.emulator.bus.send('serial0-input', data.charCodeAt(i));
    }
  }

  attachTerminal(callback: (data: string) => void): void {
    if (!this.instance) return;
    this.instance.onSerialOutput = callback;
  }

  detachTerminal(): void {
    if (!this.instance) return;
    this.instance.onSerialOutput = null;
  }

  getSerialHistory(): string {
    return this.instance?.serialBuffer ?? '';
  }

  getState(): VmState | 'none' {
    return this.instance?.state ?? 'none';
  }

  async createFile(path: string, data: ArrayBuffer): Promise<void> {
    if (!this.instance?.emulator) throw new Error('VM not running');
    await this.instance.emulator.create_file(path, new Uint8Array(data));
  }

  async readFile(path: string): Promise<Uint8Array> {
    if (!this.instance?.emulator) throw new Error('VM not running');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fs = this.instance.emulator.fs9p as any;
    if (!fs) throw new Error('Filesystem not available');

    // Resolve the file inode: use SearchPath for the parent dir (which
    // handles forwarders correctly), then look up the child in direntries
    const lastSlash = path.lastIndexOf('/');
    const parentPath = lastSlash <= 0 ? '/' : path.substring(0, lastSlash);
    const fileName = path.substring(lastSlash + 1);

    const parentResult = fs.SearchPath(parentPath);
    if (parentResult.id === -1) throw new Error('File not found: ' + path);

    const parentInode = fs.inodes[parentResult.id];
    if (!parentInode?.direntries) throw new Error('File not found: ' + path);

    const childId = parentInode.direntries.get(fileName);
    if (childId === undefined) throw new Error('File not found: ' + path);

    const inode = fs.inodes[childId];

    // Follow symlinks
    if ((inode.mode & 0xf000) === 0xa000 && inode.symlink) {
      const target = inode.symlink.startsWith('/')
        ? inode.symlink
        : parentPath + '/' + inode.symlink;
      return this.readFile(target);
    }

    // Read file data — handles both basefs (lazy-loaded) and runtime files
    if (fs.inodedata[childId]) {
      const d = fs.inodedata[childId];
      return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    }
    const data = await fs.Read(childId, 0, inode.size);
    if (!data) throw new Error('Could not read file: ' + path);
    return new Uint8Array(data);
  }

  listDirectory(path: string): VmFileEntry[] {
    if (!this.instance?.emulator?.fs9p) return [];
    const fs = this.instance.emulator.fs9p;
    const result = fs.SearchPath(path);
    if (result.id === -1) return [];
    const inode = fs.inodes[result.id];
    if (!inode || !inode.direntries) return [];

    const entries: VmFileEntry[] = [];
    for (const [name, childId] of inode.direntries) {
      if (name === '.' || name === '..') continue;
      const child = fs.inodes[childId];
      if (!child) continue;
      const mode = child.mode & 0xf000;
      entries.push({
        name,
        isDirectory: mode === 0x4000,
        isSymlink: mode === 0xa000,
        size: child.size || 0,
      });
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }
}

export interface VmFileEntry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
}

export const v86Manager = new V86Manager();
