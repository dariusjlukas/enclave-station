import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faUserMinus } from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { TaskBoardPermission } from '../../types';
import { useChatStore } from '../../stores/chatStore';

interface Props {
  spaceId: string;
  onClose: () => void;
}

export function TaskPermissions({ spaceId, onClose }: Props) {
  const spaces = useChatStore((s) => s.spaces);
  const space = spaces.find((s) => s.id === spaceId);

  const [permissions, setPermissions] = useState<TaskBoardPermission[]>([]);
  const [loading, setLoading] = useState(true);

  // Add permission form
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPerm, setSelectedPerm] = useState('edit');

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

  const handleAdd = async () => {
    if (!selectedUserId) return;
    try {
      await api.setTaskPermission(spaceId, selectedUserId, selectedPerm);
      setSelectedUserId('');
      loadPermissions();
    } catch {
      // ignore
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await api.removeTaskPermission(spaceId, userId);
      loadPermissions();
    } catch {
      // ignore
    }
  };

  const members = space?.members || [];
  const permUserIds = new Set(permissions.map((p) => p.user_id));
  const availableMembers = members.filter((m) => !permUserIds.has(m.id));

  return (
    <Modal isOpen onClose={onClose} size='lg'>
      <ModalContent>
        <ModalHeader>Task Board Permissions</ModalHeader>
        <ModalBody>
          <p className='text-sm text-default-500 mb-3'>
            Control who can view and edit task boards in this space. By default,
            permissions follow space roles.
          </p>

          {/* Current permissions */}
          <div className='space-y-2 mb-4'>
            {permissions.map((p) => (
              <div
                key={p.id}
                className='flex items-center justify-between px-3 py-2 rounded-lg bg-content2'
              >
                <div>
                  <span className='text-sm font-medium'>
                    {p.display_name || p.username}
                  </span>
                  <span className='text-xs text-default-400 ml-2'>
                    @{p.username}
                  </span>
                </div>
                <div className='flex items-center gap-2'>
                  <span className='text-xs px-2 py-0.5 rounded-full bg-default-100 capitalize'>
                    {p.permission}
                  </span>
                  <Button
                    isIconOnly
                    variant='light'
                    size='sm'
                    color='danger'
                    onPress={() => handleRemove(p.user_id)}
                    title='Remove permission'
                  >
                    <FontAwesomeIcon icon={faUserMinus} className='text-xs' />
                  </Button>
                </div>
              </div>
            ))}
            {permissions.length === 0 && !loading && (
              <p className='text-sm text-default-400 text-center py-4'>
                No custom permissions set. Using space defaults.
              </p>
            )}
          </div>

          {/* Add permission */}
          {availableMembers.length > 0 && (
            <div className='flex items-end gap-2'>
              <div className='flex-1'>
                <label className='text-xs font-semibold text-default-500 block mb-1'>
                  Add User
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm'
                >
                  <option value=''>Select a member...</option>
                  {availableMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name || m.username} (@{m.username})
                    </option>
                  ))}
                </select>
              </div>
              <div className='w-28'>
                <label className='text-xs font-semibold text-default-500 block mb-1'>
                  Level
                </label>
                <select
                  value={selectedPerm}
                  onChange={(e) => setSelectedPerm(e.target.value)}
                  className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm'
                >
                  <option value='view'>View</option>
                  <option value='edit'>Edit</option>
                  <option value='owner'>Owner</option>
                </select>
              </div>
              <Button
                size='sm'
                color='primary'
                startContent={
                  <FontAwesomeIcon icon={faUserPlus} className='text-xs' />
                }
                onPress={handleAdd}
                isDisabled={!selectedUserId}
              >
                Add
              </Button>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='flat' onPress={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
