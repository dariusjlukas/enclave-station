import { useState, useEffect, useCallback } from 'react';
import * as api from '../../services/api';
import type { TaskBoardPermission } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import { PermissionEditor } from '../common/PermissionEditor';

interface Props {
  spaceId: string;
  onClose: () => void;
}

export function TaskPermissions({ spaceId, onClose }: Props) {
  const spaces = useChatStore((s) => s.spaces);
  const space = spaces.find((s) => s.id === spaceId);

  const [permissions, setPermissions] = useState<TaskBoardPermission[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPermissions = useCallback(async () => {
    try {
      const { permissions: perms } = await api.getTaskPermissions(spaceId);
      setPermissions(perms);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const handleSet = async (userId: string, permission: string) => {
    await api.setTaskPermission(spaceId, userId, permission);
    await loadPermissions();
  };

  const handleRemove = async (userId: string) => {
    await api.removeTaskPermission(spaceId, userId);
    await loadPermissions();
  };

  const availableUsers = (space?.members || []).map((m) => ({
    id: m.id,
    username: m.username,
    display_name: m.display_name,
  }));

  return (
    <PermissionEditor
      title='Task Board Permissions'
      description='Control who can view and edit task boards in this space. Space admins and owners always have full access.'
      isOpen
      onClose={onClose}
      permissions={permissions}
      loading={loading}
      availableUsers={availableUsers}
      onSet={handleSet}
      onRemove={handleRemove}
      hideOwnerLevel={space?.is_personal}
      searchAllUsers={space?.is_personal}
    />
  );
}
