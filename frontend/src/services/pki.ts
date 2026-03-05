const DB_NAME = 'isle-chat-pki';
const STORE_NAME = 'keys';
const KEY_ID = 'default';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function generateKeyPair(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // NOT extractable
    ['sign', 'verify'],
  );

  const spkiBytes = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyB64 = bufferToBase64url(spkiBytes);

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      id: KEY_ID,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      publicKeyB64,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  return publicKeyB64;
}

export async function signChallenge(challenge: string): Promise<string> {
  const { privateKey } = await loadKeyPair();
  const data = new TextEncoder().encode(challenge);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data,
  );
  return bufferToBase64url(signature);
}

export async function hasStoredKey(): Promise<boolean> {
  try {
    const db = await openDB();
    const result = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_ID);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
    db.close();
    return result;
  } catch {
    return false;
  }
}

export async function getStoredPublicKey(): Promise<string | null> {
  try {
    const db = await openDB();
    const result = await new Promise<string | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_ID);
      req.onsuccess = () => resolve(req.result?.publicKeyB64 ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearStoredKey(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyB64: string;
}> {
  const db = await openDB();
  const result = await new Promise<{
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeyB64: string;
  } | null>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();

  if (!result) throw new Error('No stored key pair found');
  return result;
}

// Re-export for convenience
export { base64urlToBuffer, bufferToBase64url };
