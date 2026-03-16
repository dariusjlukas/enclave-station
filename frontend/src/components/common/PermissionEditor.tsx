import { useState, useMemo } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Select,
  SelectItem,
  Spinner,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUserPlus,
  faUserMinus,
  faShield,
} from '@fortawesome/free-solid-svg-icons';
import { useChatStore } from '../../stores/chatStore';

/** Shape every tool's permission rows share. */
export interface PermissionEntry {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  permission: string;
}

/** A user that can be picked in the "add" form. */
export interface AvailableUser {
  id: string;
  username: string;
  display_name?: string;
}

export interface PermissionEditorContentProps {
  /** Short description shown above the list. */
  description?: string;
  /** Current permission entries to display. */
  permissions: PermissionEntry[];
  /** True while the initial load is in progress. */
  loading?: boolean;
  /** Users available for granting new permissions. */
  availableUsers: AvailableUser[];
  /** Whether the current user can add/remove permissions. */
  canManage?: boolean;
  /** Called when a permission is added or changed. */
  onSet: (userId: string, permission: string) => Promise<void>;
  /** Called when a permission is removed. */
  onRemove: (userId: string) => Promise<void>;
  /** Hide "owner" from the permission level options (e.g., personal spaces). */
  hideOwnerLevel?: boolean;
  /** If true, show an inline dropdown to change existing permissions.
   *  If false, show a static badge (remove and re-add to change). Defaults to true. */
  inlineEdit?: boolean;
  /** Search all server users instead of only the availableUsers list.
   *  Useful for personal spaces where there are no other space members. */
  searchAllUsers?: boolean;
}

/** Renders the permission list + add form without a modal wrapper.
 *  Use this when embedding inside your own modal (e.g., wiki's tabbed view). */
export function PermissionEditorContent({
  description,
  permissions,
  loading = false,
  availableUsers,
  canManage = true,
  onSet,
  onRemove,
  hideOwnerLevel = false,
  inlineEdit = true,
  searchAllUsers = false,
}: PermissionEditorContentProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPerm, setSelectedPerm] = useState('edit');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const allUsers = useChatStore((s) => s.users);

  const permLevels = useMemo(
    () =>
      hideOwnerLevel
        ? [
            { key: 'view', label: 'View' },
            { key: 'edit', label: 'Edit' },
          ]
        : [
            { key: 'view', label: 'View' },
            { key: 'edit', label: 'Edit' },
            { key: 'owner', label: 'Owner' },
          ],
    [hideOwnerLevel],
  );

  const permUserIds = useMemo(
    () => new Set(permissions.map((p) => p.user_id)),
    [permissions],
  );

  const searchResults = useMemo(() => {
    if (!searchAllUsers || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allUsers
      .filter(
        (u) =>
          !permUserIds.has(u.id) &&
          (u.username.toLowerCase().includes(q) ||
            (u.display_name && u.display_name.toLowerCase().includes(q))),
      )
      .slice(0, 8);
  }, [searchAllUsers, searchQuery, allUsers, permUserIds]);

  const filteredAvailable = useMemo(
    () => availableUsers.filter((u) => !permUserIds.has(u.id)),
    [availableUsers, permUserIds],
  );

  const handleAdd = async () => {
    if (!selectedUserId) return;
    setActionLoading('add');
    try {
      await onSet(selectedUserId, selectedPerm);
      setSelectedUserId('');
      setSearchQuery('');
      setShowAdd(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChange = async (userId: string, permission: string) => {
    setActionLoading(userId);
    try {
      await onSet(userId, permission);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (userId: string) => {
    setActionLoading(userId);
    try {
      await onRemove(userId);
    } finally {
      setActionLoading(null);
    }
  };

  const permBadgeClass = (perm: string) => {
    if (perm === 'owner') return 'bg-warning/20 text-warning';
    if (perm === 'edit') return 'bg-primary/20 text-primary';
    return 'bg-default-100 text-default-500';
  };

  const showAddSection =
    canManage && (searchAllUsers || filteredAvailable.length > 0);

  if (loading) {
    return (
      <div className='flex justify-center py-8'>
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      {description && (
        <p className='text-sm text-default-500 mb-3'>{description}</p>
      )}

      {/* Existing permissions */}
      <div className='space-y-2'>
        {permissions.map((p) => (
          <div
            key={p.id}
            className='flex items-center justify-between px-3 py-2 rounded-lg bg-content2/50'
          >
            <div className='min-w-0'>
              <span className='text-sm font-medium'>
                {p.display_name || p.username}
              </span>
              <span className='text-xs text-default-400 ml-1.5'>
                @{p.username}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              {inlineEdit && canManage ? (
                <Select
                  selectedKeys={[p.permission]}
                  onSelectionChange={(keys) => {
                    const perm = Array.from(keys)[0] as string;
                    if (perm && perm !== p.permission)
                      handleChange(p.user_id, perm);
                  }}
                  size='sm'
                  className='w-28'
                  isDisabled={actionLoading === p.user_id}
                  aria-label='Permission level'
                >
                  {permLevels.map((l) => (
                    <SelectItem key={l.key}>{l.label}</SelectItem>
                  ))}
                </Select>
              ) : (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full capitalize ${permBadgeClass(p.permission)}`}
                >
                  {p.permission}
                </span>
              )}
              {canManage && (
                <Button
                  isIconOnly
                  variant='light'
                  size='sm'
                  color='danger'
                  title='Remove permission'
                  isLoading={actionLoading === p.user_id}
                  onPress={() => handleRemove(p.user_id)}
                >
                  <FontAwesomeIcon icon={faUserMinus} className='text-xs' />
                </Button>
              )}
            </div>
          </div>
        ))}
        {permissions.length === 0 && (
          <p className='text-sm text-default-400 text-center py-4'>
            No custom permissions set.
          </p>
        )}
      </div>

      {/* Add permission */}
      {showAddSection &&
        (showAdd ? (
          <div className='flex items-end gap-2 mt-4 pt-4 border-t border-divider'>
            <div className='flex-1 relative'>
              {searchAllUsers ? (
                <>
                  <label className='text-xs font-semibold text-default-500 block mb-1'>
                    User
                  </label>
                  <input
                    type='text'
                    placeholder='Search users...'
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (!e.target.value) setSelectedUserId('');
                    }}
                    className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm outline-none focus:border-primary'
                  />
                  {selectedUserId && (
                    <p className='text-xs text-default-400 mt-1'>
                      Selected:{' '}
                      {allUsers.find((u) => u.id === selectedUserId)
                        ?.username ?? selectedUserId}
                    </p>
                  )}
                  {searchQuery && !selectedUserId && (
                    <div className='absolute z-20 top-full left-0 right-0 mt-1 bg-content1 border border-divider rounded-lg shadow-lg max-h-40 overflow-y-auto'>
                      {searchResults.map((u) => (
                        <button
                          key={u.id}
                          type='button'
                          className='w-full text-left px-3 py-2 text-sm hover:bg-content2 transition-colors cursor-pointer'
                          onClick={() => {
                            setSelectedUserId(u.id);
                            setSearchQuery(u.display_name || u.username);
                          }}
                        >
                          {u.display_name || u.username}{' '}
                          <span className='text-default-400'>
                            @{u.username}
                          </span>
                        </button>
                      ))}
                      {searchResults.length === 0 && (
                        <p className='px-3 py-2 text-sm text-default-400'>
                          No users found
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className='text-xs font-semibold text-default-500 block mb-1'>
                    User
                  </label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm'
                  >
                    <option value=''>Select a member...</option>
                    {filteredAvailable.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name || u.username} (@{u.username})
                      </option>
                    ))}
                  </select>
                </>
              )}
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
                {permLevels.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
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
              isLoading={actionLoading === 'add'}
            >
              Add
            </Button>
            <Button
              variant='light'
              size='sm'
              onPress={() => {
                setShowAdd(false);
                setSelectedUserId('');
                setSearchQuery('');
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant='flat'
            size='sm'
            onPress={() => setShowAdd(true)}
            startContent={<FontAwesomeIcon icon={faUserPlus} />}
            className='mt-4'
          >
            Add Permission
          </Button>
        ))}
    </div>
  );
}

/** Full modal wrapper around PermissionEditorContent. */
interface PermissionEditorProps extends PermissionEditorContentProps {
  /** Modal title. */
  title: string;
  /** Whether the modal is open. */
  isOpen: boolean;
  /** Close callback. */
  onClose: () => void;
}

export function PermissionEditor({
  title,
  isOpen,
  onClose,
  ...contentProps
}: PermissionEditorProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size='lg' scrollBehavior='inside'>
      <ModalContent>
        <ModalHeader className='flex items-center gap-2'>
          <FontAwesomeIcon icon={faShield} className='text-primary' />
          {title}
        </ModalHeader>
        <ModalBody>
          <PermissionEditorContent {...contentProps} />
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
