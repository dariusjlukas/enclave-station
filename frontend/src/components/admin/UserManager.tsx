import { useState, useEffect } from 'react';
import { Select, SelectItem, Button, Card, CardBody } from '@heroui/react';
import { useChatStore } from '../../stores/chatStore';
import * as api from '../../services/api';
import { OnlineStatusDot } from '../common/OnlineStatusDot';
import { UserPopoverCard } from '../common/UserPopoverCard';
import { UserPicker } from '../common/UserPicker';

interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  is_online: boolean;
  last_seen: string;
  is_banned: boolean;
}

export function UserManager() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string[]>([]);
  const currentUser = useChatStore((s) => s.user);
  const setStoreUsers = useChatStore((s) => s.setUsers);

  const refreshUsers = async () => {
    try {
      const data = await api.listAdminUsers();
      setUsers(data);
    } catch {
      // ignore fetch errors
    }
  };

  useEffect(() => {
    api
      .listAdminUsers()
      .then(setUsers)
      .catch(() => {});
    api
      .listUsers()
      .then(setStoreUsers)
      .catch(() => {});
  }, [setStoreUsers]);

  const handleChangeRole = async (userId: string, newRole: string) => {
    setError(null);
    try {
      await api.changeUserRole(userId, newRole);
      await refreshUsers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to change role';
      setError(msg);
    }
  };

  const handleBan = async (userId: string) => {
    setError(null);
    try {
      await api.banUser(userId);
      await refreshUsers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to ban user';
      setError(msg);
    }
  };

  const handleUnban = async (userId: string) => {
    setError(null);
    try {
      await api.unbanUser(userId);
      await refreshUsers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to unban user';
      setError(msg);
    }
  };

  const SERVER_RANK: Record<string, number> = {
    owner: 2,
    admin: 1,
    user: 0,
  };
  const actorRank = SERVER_RANK[currentUser?.role ?? 'user'] ?? 0;

  const ALL_ROLES = [
    { key: 'owner', label: 'Owner', rank: 2 },
    { key: 'admin', label: 'Admin', rank: 1 },
    { key: 'user', label: 'User', rank: 0 },
  ];

  const canEditUser = (u: AdminUser) => {
    const targetRank = SERVER_RANK[u.role] ?? 0;
    const isSelf = u.id === currentUser?.id;
    return targetRank < actorRank || isSelf;
  };

  const canBanUser = (u: AdminUser) => {
    const targetRank = SERVER_RANK[u.role] ?? 0;
    const isSelf = u.id === currentUser?.id;
    return targetRank < actorRank && !isSelf;
  };

  const roleItems = ALL_ROLES.filter((r) => r.rank <= actorRank);

  const selectedUser = users.find((u) => u.id === selectedUserId[0]);

  return (
    <div>
      <div className='mb-4'>
        <UserPicker
          mode='single'
          selected={selectedUserId}
          onChange={setSelectedUserId}
          label='Select user'
          placeholder='Search users...'
        />
      </div>

      {error && <p className='text-xs text-danger mb-2'>{error}</p>}

      {selectedUser && (
        <Card>
          <CardBody className='space-y-3'>
            <div className='flex items-center gap-3'>
              <UserPopoverCard userId={selectedUser.id}>
                <div className='flex items-center gap-2 cursor-pointer'>
                  <OnlineStatusDot
                    isOnline={selectedUser.is_online}
                    lastSeen={selectedUser.last_seen}
                  />
                  <div>
                    <span className='text-sm font-medium hover:underline'>
                      {selectedUser.display_name}
                    </span>
                    <span className='text-xs text-default-400 ml-1'>
                      @{selectedUser.username}
                    </span>
                    {selectedUser.is_banned && (
                      <span className='text-xs text-danger ml-2 font-medium'>
                        Banned
                      </span>
                    )}
                  </div>
                </div>
              </UserPopoverCard>
            </div>

            <div className='border border-default-200 rounded-lg overflow-hidden'>
              <table className='w-full text-sm'>
                <tbody>
                  <tr>
                    <td className='py-2 px-3 text-default-600 border-r border-default-200'>
                      Role
                    </td>
                    <td className='py-2 px-3 text-right'>
                      {canEditUser(selectedUser) && !selectedUser.is_banned ? (
                        <Select
                          size='sm'
                          variant='bordered'
                          className='w-28 ml-auto'
                          selectedKeys={[selectedUser.role]}
                          onChange={(e) =>
                            handleChangeRole(selectedUser.id, e.target.value)
                          }
                          aria-label='Role'
                          items={roleItems}
                        >
                          {(item) => (
                            <SelectItem key={item.key}>{item.label}</SelectItem>
                          )}
                        </Select>
                      ) : (
                        <span className='text-default-400 capitalize'>
                          {selectedUser.role}
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr className='border-t border-default-200'>
                    <td className='py-2 px-3 text-default-600 border-r border-default-200'>
                      Status
                    </td>
                    <td className='py-2 px-3 text-right'>
                      {selectedUser.is_banned ? (
                        <span className='text-danger text-sm'>Banned</span>
                      ) : (
                        <span className='text-success text-sm'>Active</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {canBanUser(selectedUser) &&
              (selectedUser.is_banned ? (
                <Button
                  variant='flat'
                  color='success'
                  size='sm'
                  fullWidth
                  onPress={() => handleUnban(selectedUser.id)}
                >
                  Unban User
                </Button>
              ) : (
                <Button
                  variant='flat'
                  color='danger'
                  size='sm'
                  fullWidth
                  onPress={() => handleBan(selectedUser.id)}
                >
                  Ban User
                </Button>
              ))}

            <Button
              variant='light'
              color='default'
              size='sm'
              fullWidth
              onPress={() => setSelectedUserId([])}
            >
              Done
            </Button>
          </CardBody>
        </Card>
      )}

      {!selectedUser && users.length === 0 && (
        <p className='text-default-500 text-sm'>No users found.</p>
      )}
    </div>
  );
}
