import type { User, Channel, Message } from '../types';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('session_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  return res.json();
}

// Auth — WebAuthn
export function getRegistrationOptions(data: {
  username: string;
  display_name: string;
  token?: string;
}) {
  return request<PublicKeyCredentialCreationOptionsJSON>(
    '/auth/register/options',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function verifyRegistration(credential: RegistrationResponseJSON) {
  return request<{ token: string; user: User }>('/auth/register/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  });
}

export function getLoginOptions() {
  return request<PublicKeyCredentialRequestOptionsJSON>('/auth/login/options', {
    method: 'POST',
    body: '{}',
  });
}

export function verifyLogin(credential: AuthenticationResponseJSON) {
  return request<{ token: string; user: User }>('/auth/login/verify', {
    method: 'POST',
    body: JSON.stringify(credential),
  });
}

export function requestAccessOptions(data: {
  username: string;
  display_name: string;
}) {
  return request<PublicKeyCredentialCreationOptionsJSON>(
    '/auth/request-access/options',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function requestAccess(data: {
  username: string;
  display_name: string;
  auth_method: string;
  public_key?: string;
  challenge?: string;
  signature?: string;
  credential?: RegistrationResponseJSON;
}) {
  return request<{ request_id: string; status: string }>(
    '/auth/request-access',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function getRequestStatus(requestId: string) {
  return request<{ status: string; token?: string; user?: User }>(
    `/auth/request-status/${encodeURIComponent(requestId)}`,
  );
}

export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

// Users
export function getMe() {
  return request<User>('/users/me');
}

export function listUsers() {
  return request<User[]>('/users');
}

// Channels
export function listChannels() {
  return request<Channel[]>('/channels');
}

export function createChannel(
  name: string,
  description?: string,
  memberIds?: string[],
  isPublic = true,
  defaultRole = 'write',
) {
  return request<{
    id: string;
    name: string;
    description: string;
    is_direct: boolean;
    created_at: string;
  }>('/channels', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      member_ids: memberIds,
      is_public: isPublic,
      default_role: defaultRole,
    }),
  });
}

export function getMessages(
  channelId: string,
  before?: string,
  limit?: number,
) {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  if (limit) params.set('limit', limit.toString());
  const qs = params.toString();
  return request<Message[]>(
    `/channels/${channelId}/messages${qs ? '?' + qs : ''}`,
  );
}

export function createDM(userId: string) {
  return request<{
    id: string;
    name: string;
    is_direct: boolean;
    created_at: string;
  }>('/channels/dm', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export function joinChannel(channelId: string) {
  return request<{ ok: boolean }>(`/channels/${channelId}/join`, {
    method: 'POST',
  });
}

export function listPublicChannels(search?: string) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const qs = params.toString();
  return request<
    Array<{
      id: string;
      name: string;
      description: string;
      is_public: boolean;
      default_role: string;
      created_at: string;
    }>
  >(`/channels/public${qs ? '?' + qs : ''}`);
}

export function inviteToChannel(
  channelId: string,
  userId: string,
  role?: string,
) {
  return request<{ ok: boolean }>(`/channels/${channelId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role }),
  });
}

export function kickFromChannel(channelId: string, userId: string) {
  return request<{ ok: boolean }>(`/channels/${channelId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export function changeMemberRole(
  channelId: string,
  userId: string,
  role: string,
) {
  return request<{ ok: boolean }>(`/channels/${channelId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export function updateChannelSettings(
  channelId: string,
  data: {
    name?: string;
    description?: string;
    is_public?: boolean;
    default_role?: string;
  },
) {
  return request<Channel>(`/channels/${channelId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// Admin
export function createInvite(expiryHours = 24) {
  return request<{ token: string }>('/admin/invites', {
    method: 'POST',
    body: JSON.stringify({ expiry_hours: expiryHours }),
  });
}

export function listInvites() {
  return request<
    Array<{
      id: string;
      token: string;
      created_by: string;
      used: boolean;
      expires_at: string;
      created_at: string;
    }>
  >('/admin/invites');
}

export function listJoinRequests() {
  return request<
    Array<{
      id: string;
      username: string;
      display_name: string;
      auth_method: string;
      status: string;
      created_at: string;
    }>
  >('/admin/requests');
}

export function approveRequest(requestId: string) {
  return request<{ ok: boolean }>(`/admin/requests/${requestId}/approve`, {
    method: 'POST',
  });
}

export function denyRequest(requestId: string) {
  return request<{ ok: boolean }>(`/admin/requests/${requestId}/deny`, {
    method: 'POST',
  });
}

// Profile
export function updateProfile(data: {
  display_name?: string;
  bio?: string;
  status?: string;
}) {
  return request<{
    id: string;
    username: string;
    display_name: string;
    role: string;
    bio: string;
    status: string;
  }>('/users/me', { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteAccount() {
  return request<{ ok: boolean }>('/users/me', { method: 'DELETE' });
}

// Files
export function uploadFile(
  channelId: string,
  file: File,
  messageText: string,
  onProgress?: (percent: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const params = new URLSearchParams({
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
    });
    if (messageText) params.set('message', messageText);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/channels/${channelId}/upload?${params}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || xhr.statusText));
        } catch {
          reject(new Error(xhr.statusText));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}

export function getFileUrl(fileId: string): string {
  const token = getToken();
  return `${API_BASE}/files/${fileId}?token=${token}`;
}

export async function downloadFile(
  fileId: string,
  fileName: string,
  onProgress?: (percent: number) => void,
) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/files/${fileId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) throw new Error('Download failed');

  const contentLength = res.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!res.body || !total) {
    const blob = await res.blob();
    triggerDownload(blob, fileName);
    return;
  }

  const reader = res.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
    received += value.length;
    if (onProgress) {
      onProgress(Math.round((received / total) * 100));
    }
  }

  const blob = new Blob(chunks);
  triggerDownload(blob, fileName);
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Admin settings
export interface AdminSettings {
  max_file_size: number;
  max_storage_size: number;
  storage_used: number;
  auth_methods: string[];
  server_name: string;
  registration_mode: string;
  file_uploads_enabled: boolean;
  session_expiry_hours: number;
  setup_completed: boolean;
}

export function getAdminSettings() {
  return request<AdminSettings>('/admin/settings');
}

export function updateAdminSettings(
  data: Partial<Omit<AdminSettings, 'storage_used' | 'setup_completed'>>,
) {
  return request<{ ok: boolean }>('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function completeSetup(
  data: Partial<Omit<AdminSettings, 'storage_used' | 'setup_completed'>>,
) {
  return request<{ ok: boolean }>('/admin/setup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Config
export interface PublicConfig {
  public_url: string;
  auth_methods: string[];
  server_name: string;
  registration_mode: string;
  setup_completed: boolean;
  file_uploads_enabled: boolean;
}

export function getPublicConfig() {
  return request<PublicConfig>('/config');
}

// PKI auth
export function getPkiChallenge(publicKey?: string) {
  return request<{ challenge: string }>('/auth/pki/challenge', {
    method: 'POST',
    body: JSON.stringify({ public_key: publicKey }),
  });
}

export function pkiRegister(data: {
  username: string;
  display_name: string;
  token?: string;
  public_key: string;
  challenge: string;
  signature: string;
}) {
  return request<{ token: string; user: User; recovery_keys: string[] }>(
    '/auth/pki/register',
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export function pkiLogin(data: {
  public_key: string;
  challenge: string;
  signature: string;
}) {
  return request<{ token: string; user: User }>('/auth/pki/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function recoveryLogin(recoveryKey: string) {
  return request<{ token: string; user: User; must_setup_key: boolean }>(
    '/auth/recovery',
    { method: 'POST', body: JSON.stringify({ recovery_key: recoveryKey }) },
  );
}

// PKI key management
export function getPkiKeyChallenge() {
  return request<{ challenge: string }>('/users/me/keys/challenge', {
    method: 'POST',
  });
}

export function addPkiKey(data: {
  public_key: string;
  challenge: string;
  signature: string;
  device_name?: string;
}) {
  return request<{ ok: boolean; recovery_keys?: string[] }>('/users/me/keys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listPkiKeys() {
  return request<
    Array<{ id: string; device_name: string; created_at: string }>
  >('/users/me/keys');
}

export function removePkiKey(id: string) {
  return request<{ ok: boolean }>(`/users/me/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// Recovery key management
export function getRecoveryKeyCount() {
  return request<{ remaining: number }>('/users/me/recovery-keys/count');
}

export function regenerateRecoveryKeys() {
  return request<{ recovery_keys: string[] }>(
    '/users/me/recovery-keys/regenerate',
    { method: 'POST' },
  );
}

// Passkeys
export function getPasskeyRegistrationOptions() {
  return request<
    import('@simplewebauthn/browser').PublicKeyCredentialCreationOptionsJSON
  >('/users/me/passkeys/options', { method: 'POST' });
}

export function verifyPasskeyRegistration(
  credential: RegistrationResponseJSON,
  deviceName?: string,
) {
  return request<{ ok: boolean }>('/users/me/passkeys/verify', {
    method: 'POST',
    body: JSON.stringify({ ...credential, device_name: deviceName }),
  });
}

export function listPasskeys() {
  return request<
    Array<{ id: string; device_name: string; created_at: string }>
  >('/users/me/passkeys');
}

export function removePasskey(credentialId: string) {
  return request<{ ok: boolean }>(
    `/users/me/passkeys/${encodeURIComponent(credentialId)}`,
    { method: 'DELETE' },
  );
}
