import { useState, useEffect } from 'react';
import * as Y from 'yjs';
import { wsService } from '../../services/websocket';

// --- Base64 helpers ---

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- WikiProvider class ---

export class WikiProvider {
  connected = false;
  doc: Y.Doc;
  awareness: WikiAwareness;
  _destroyed = false;

  constructor(
    doc: Y.Doc,
    _pageId: string,
    _userId: string,
    awareness: WikiAwareness,
  ) {
    this.doc = doc;
    this.awareness = awareness;
  }

  destroy() {
    this._destroyed = true;
    this.connected = false;
  }

  get isDestroyed() {
    return this._destroyed;
  }
}

// --- Minimal awareness-like object ---

export class WikiAwareness {
  private _states = new Map<
    number,
    { user?: { name: string; color: string } }
  >();
  private _localClientID: number;
  private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(doc: Y.Doc) {
    this._localClientID = doc.clientID;
  }

  get clientID() {
    return this._localClientID;
  }

  getStates() {
    return this._states;
  }

  getLocalState() {
    return this._states.get(this._localClientID) ?? null;
  }

  setLocalStateField(field: string, value: unknown) {
    const current = this._states.get(this._localClientID) ?? {};
    const next = { ...current, [field]: value };
    this._states.set(this._localClientID, next);
    this._emit('change', [
      { added: [], updated: [this._localClientID], removed: [] },
    ]);
  }

  on(event: string, fn: (...args: unknown[]) => void) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(fn);
  }

  off(event: string, fn: (...args: unknown[]) => void) {
    this._listeners.get(event)?.delete(fn);
  }

  private _emit(event: string, args: unknown[]) {
    this._listeners.get(event)?.forEach((fn) => fn(...args));
  }

  destroy() {
    this._listeners.clear();
    this._states.clear();
  }
}

// --- Hook ---

interface UseWikiCollaborationResult {
  ydoc: Y.Doc;
  provider: WikiProvider;
  isConnected: boolean;
}

export function useWikiCollaboration(
  spaceId: string,
  pageId: string,
  userName: string,
  userColor: string,
): UseWikiCollaborationResult | null {
  const [isConnected, setIsConnected] = useState(false);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<WikiProvider | null>(null);

  useEffect(() => {
    if (!spaceId || !pageId) return;

    const ydoc = new Y.Doc();
    const awareness = new WikiAwareness(ydoc);
    const provider = new WikiProvider(ydoc, pageId, '', awareness);

    // Set local awareness
    awareness.setLocalStateField('user', {
      name: userName,
      color: userColor,
    });

    // Join the collaborative editing session
    wsService.send({ type: 'wiki_join', page_id: pageId });
    provider.connected = true;

    // Handle incoming updates from other users
    const handleUpdate = (data: unknown) => {
      const msg = data as {
        type: string;
        page_id: string;
        user_id?: string;
        data: string;
      };
      if (msg.page_id !== pageId) return;
      try {
        const update = base64ToUint8Array(msg.data);
        Y.applyUpdate(ydoc, update, 'remote');
      } catch (err) {
        console.error('[WikiCollab] Failed to apply update:', err);
      }
    };

    const handleAwareness = (data: unknown) => {
      const msg = data as {
        type: string;
        page_id: string;
        user_id?: string;
        data: string;
      };
      if (msg.page_id !== pageId) return;
      // Awareness updates could be processed here in the future
    };

    const offUpdate = wsService.on('wiki_update', handleUpdate);
    const offAwareness = wsService.on('wiki_awareness', handleAwareness);

    // Broadcast local updates to other users
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      wsService.send({
        type: 'wiki_update',
        page_id: pageId,
        data: uint8ArrayToBase64(update),
      });
    };

    ydoc.on('update', onDocUpdate);

    // Track connection state
    const offState = wsService.onStateChange((state) => {
      const connected = state === 'connected';
      provider.connected = connected;
      setIsConnected(connected);
    });

    // Expose ydoc/provider to the hook consumer after all subscriptions are ready
    queueMicrotask(() => {
      setYdoc(ydoc);
      setProvider(provider);
      setIsConnected(true);
    });

    return () => {
      // Leave the session
      wsService.send({ type: 'wiki_leave', page_id: pageId });

      // Cleanup handlers
      offUpdate();
      offAwareness();
      offState();
      ydoc.off('update', onDocUpdate);

      // Destroy
      awareness.destroy();
      provider.destroy();
      ydoc.destroy();
      setYdoc(null);
      setProvider(null);
    };
  }, [spaceId, pageId, userName, userColor]);

  if (!ydoc || !provider) return null;

  return { ydoc, provider, isConnected };
}
