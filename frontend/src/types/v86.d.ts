declare module 'v86' {
  interface V86Options {
    wasm_path?: string;
    bios?: { url: string } | { buffer: ArrayBuffer };
    vga_bios?: { url: string } | { buffer: ArrayBuffer };
    cdrom?: { url: string } | { buffer: ArrayBuffer };
    hda?: { url: string; size?: number } | { buffer: ArrayBuffer };
    fda?: { url: string } | { buffer: ArrayBuffer };
    bzimage?: { url: string } | { buffer: ArrayBuffer };
    initrd?: { url: string } | { buffer: ArrayBuffer };
    cmdline?: string;
    memory_size?: number;
    vga_memory_size?: number;
    autostart?: boolean;
    disable_mouse?: boolean;
    disable_keyboard?: boolean;
    screen_container?: HTMLElement | null;
    serial_container_xtermjs?: HTMLElement | null;
    bzimage_initrd_from_filesystem?: boolean;
    filesystem?: {
      basefs?: string;
      baseurl?: string;
    };
    network_relay_url?: string;
    preserve_mac_from_state_image?: boolean;
    mac_address_translation?: boolean;
    boot_order?: number;
    acpi?: boolean;
    uart1?: boolean;
    uart2?: boolean;
    uart3?: boolean;
    log_level?: number;
  }

  class V86 {
    constructor(options: V86Options);

    add_listener(event: string, callback: (...args: unknown[]) => void): void;
    remove_listener(
      event: string,
      callback: (...args: unknown[]) => void,
    ): void;

    serial_send(char_code: number): void;

    run(): void;
    stop(): void;
    restart(): void;
    destroy(): void;

    save_state(): Promise<ArrayBuffer>;
    restore_state(state: ArrayBuffer): void;

    is_running(): boolean;

    keyboard_send_scancodes(codes: number[]): void;
  }

  export default V86;
  export { V86 };
}
