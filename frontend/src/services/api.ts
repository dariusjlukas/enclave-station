const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('session_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
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

// Auth
export function requestChallenge(publicKey: string) {
  return request<{ challenge: string }>('/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ public_key: publicKey }),
  });
}

export function verifyChallenge(publicKey: string, challenge: string, signature: string) {
  return request<{ token: string; user: { id: string; username: string; display_name: string; role: string } }>(
    '/auth/verify',
    {
      method: 'POST',
      body: JSON.stringify({ public_key: publicKey, challenge, signature }),
    }
  );
}

export function register(data: { username: string; display_name: string; public_key: string; token?: string }) {
  return request<{ token: string; user: { id: string; username: string; display_name: string; role: string } }>(
    '/auth/register',
    { method: 'POST', body: JSON.stringify(data) }
  );
}

export function requestAccess(data: { username: string; display_name: string; public_key: string }) {
  return request<{ request_id: string; status: string; message: string }>(
    '/auth/request-access',
    { method: 'POST', body: JSON.stringify(data) }
  );
}

export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

// Users
export function getMe() {
  return request<{ id: string; username: string; display_name: string; role: string; is_online: boolean }>('/users/me');
}

export function listUsers() {
  return request<Array<{ id: string; username: string; display_name: string; role: string; is_online: boolean }>>('/users');
}

// Channels
export function listChannels() {
  return request<Array<{
    id: string; name: string; description: string;
    is_direct: boolean; created_at: string;
    members: Array<{ id: string; username: string; display_name: string; is_online: boolean }>;
  }>>('/channels');
}

export function createChannel(name: string, description?: string, memberIds?: string[],
                              isPublic = true, defaultRole = 'write') {
  return request<{ id: string; name: string; description: string; is_direct: boolean; created_at: string }>(
    '/channels',
    { method: 'POST', body: JSON.stringify({ name, description, member_ids: memberIds,
                                              is_public: isPublic, default_role: defaultRole }) }
  );
}

export function getMessages(channelId: string, before?: string, limit?: number) {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  if (limit) params.set('limit', limit.toString());
  const qs = params.toString();
  return request<Array<{
    id: string; channel_id: string; user_id: string;
    username: string; content: string; created_at: string;
  }>>(`/channels/${channelId}/messages${qs ? '?' + qs : ''}`);
}

export function createDM(userId: string) {
  return request<{ id: string; name: string; is_direct: boolean; created_at: string }>(
    '/channels/dm',
    { method: 'POST', body: JSON.stringify({ user_id: userId }) }
  );
}

export function joinChannel(channelId: string) {
  return request<{ ok: boolean }>(`/channels/${channelId}/join`, { method: 'POST' });
}

export function listPublicChannels(search?: string) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const qs = params.toString();
  return request<Array<{
    id: string; name: string; description: string;
    is_public: boolean; default_role: string; created_at: string;
  }>>(`/channels/public${qs ? '?' + qs : ''}`);
}

export function inviteToChannel(channelId: string, userId: string, role?: string) {
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

export function changeMemberRole(channelId: string, userId: string, role: string) {
  return request<{ ok: boolean }>(`/channels/${channelId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export function updateChannelSettings(channelId: string, data: {
  name?: string; description?: string; is_public?: boolean; default_role?: string;
}) {
  return request<{ id: string; name: string; description: string; is_public: boolean; default_role: string }>(
    `/channels/${channelId}`,
    { method: 'PUT', body: JSON.stringify(data) }
  );
}

// Admin
export function createInvite(expiryHours = 24) {
  return request<{ token: string }>('/admin/invites', {
    method: 'POST',
    body: JSON.stringify({ expiry_hours: expiryHours }),
  });
}

export function listInvites() {
  return request<Array<{
    id: string; token: string; created_by: string;
    used: boolean; expires_at: string; created_at: string;
  }>>('/admin/invites');
}

export function listJoinRequests() {
  return request<Array<{
    id: string; username: string; display_name: string;
    status: string; created_at: string;
  }>>('/admin/requests');
}

export function approveRequest(requestId: string) {
  return request<{ ok: boolean; user_id: string }>(`/admin/requests/${requestId}/approve`, { method: 'POST' });
}

export function denyRequest(requestId: string) {
  return request<{ ok: boolean }>(`/admin/requests/${requestId}/deny`, { method: 'POST' });
}

// Profile
export function updateProfile(data: { display_name?: string; bio?: string; status?: string }) {
  return request<{ id: string; username: string; display_name: string; role: string; bio: string; status: string }>(
    '/users/me',
    { method: 'PUT', body: JSON.stringify(data) }
  );
}

export function deleteAccount() {
  return request<{ ok: boolean }>('/users/me', { method: 'DELETE' });
}

// Config
export function getPublicConfig() {
  return request<{ public_url: string }>('/config');
}

// Devices
export function createDeviceToken() {
  return request<{ token: string; expires_in_minutes: number }>('/users/me/device-tokens', {
    method: 'POST',
  });
}

export function addDevice(data: { device_token: string; public_key: string; device_name: string }) {
  return request<{ token: string; user: { id: string; username: string; display_name: string; role: string } }>(
    '/auth/add-device',
    { method: 'POST', body: JSON.stringify(data) }
  );
}

export function listDevices() {
  return request<Array<{ id: string; device_name: string; created_at: string }>>('/users/me/devices');
}

export function removeDevice(deviceId: string) {
  return request<{ ok: boolean }>(`/users/me/devices/${deviceId}`, { method: 'DELETE' });
}
