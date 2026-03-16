import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tabs,
  Tab,
  Input,
  Switch,
  Select,
  SelectItem,
  Button,
  Slider,
  Tooltip,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCamera,
  faTrashCan,
  faFolderOpen,
  faCalendar,
  faListCheck,
  faBook,
  faPuzzlePiece,
} from '@fortawesome/free-solid-svg-icons';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { useChatStore } from '../../stores/chatStore';
import * as api from '../../services/api';
import type {
  Space,
  SpaceMemberInfo,
  SpaceRole,
  SpaceToolName,
} from '../../types';
import { UserPicker } from '../common/UserPicker';
import { OnlineStatusDot } from '../common/OnlineStatusDot';
import { UserPopoverCard } from '../common/UserPopoverCard';
import { SpaceAvatar } from '../common/SpaceAvatar';

async function getCroppedBlob(imageSrc: string, crop: Area): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = imageSrc;
  });

  const canvas = document.createElement('canvas');
  const size = Math.min(crop.width, crop.height);
  const outputSize = Math.min(size, 512);
  canvas.width = outputSize;
  canvas.height = outputSize;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to crop'))),
      'image/png',
    );
  });
}

function formatStorageSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

interface Props {
  space: Space;
  onClose: () => void;
}

export function SpaceSettings({ space, onClose }: Props) {
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [isPublic, setIsPublic] = useState(space.is_public);
  const [defaultRole, setDefaultRole] = useState<SpaceRole>(space.default_role);
  const [profileColor, setProfileColor] = useState(space.profile_color || '');
  const [saving, setSaving] = useState(false);
  const [inviteUserId, setInviteUserId] = useState<string[]>([]);
  const [inviteRole, setInviteRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [savedPayload, setSavedPayload] = useState(() =>
    JSON.stringify({
      name,
      description,
      isPublic,
      defaultRole,
      profileColor,
    }),
  );

  const currentPayload = useMemo(
    () =>
      JSON.stringify({
        name,
        description,
        isPublic,
        defaultRole,
        profileColor,
      }),
    [name, description, isPublic, defaultRole, profileColor],
  );

  const isDirty = currentPayload !== savedPayload;

  // Crop state
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  const [toolsLoading, setToolsLoading] = useState<string | null>(null);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(
    new Set(space.enabled_tools || []),
  );

  const [storageUsed, setStorageUsed] = useState(0);
  const [storageLimit, setStorageLimit] = useState(0);
  const [storageBreakdown, setStorageBreakdown] = useState<
    api.StorageBreakdownEntry[]
  >([]);
  const [storageLoaded, setStorageLoaded] = useState(false);

  useEffect(() => {
    api
      .getSpaceStorage(space.id)
      .then((data) => {
        setStorageUsed(data.used);
        setStorageLimit(data.limit);
        setStorageBreakdown(data.breakdown.filter((e) => e.used > 0));
        setStorageLoaded(true);
      })
      .catch(() => setStorageLoaded(true));
  }, [space.id]);

  const storagePct =
    storageLimit > 0
      ? Math.min((storageUsed / storageLimit) * 100, 100)
      : storageUsed > 0
        ? 100
        : 0;

  const BREAKDOWN_COLORS = [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#f97316',
  ];

  const renderStorageSection = () => {
    if (!storageLoaded) {
      return (
        <p className='text-xs text-default-400'>Loading storage info...</p>
      );
    }

    const hasLimit = storageLimit > 0;
    const nearLimit = hasLimit && storagePct >= 80;
    // Denominator for bar segment widths: limit if set, otherwise total used (bar fills 100%)
    const barDenom = hasLimit ? storageLimit : storageUsed;

    return (
      <>
        {/* Header: used / limit */}
        <div className='flex items-center justify-between mb-1'>
          <span className='text-sm text-foreground'>
            {hasLimit
              ? `${formatStorageSize(storageUsed)} / ${formatStorageSize(storageLimit)}`
              : formatStorageSize(storageUsed)}
          </span>
          {hasLimit && (
            <span
              className={`text-sm ${nearLimit ? 'text-warning' : 'text-default-400'}`}
            >
              {storagePct.toFixed(1)}%
            </span>
          )}
        </div>

        {/* Stacked color bar */}
        <div className='h-3 bg-default-200 rounded-full overflow-hidden flex'>
          {storageBreakdown.length > 0
            ? storageBreakdown.map((entry, i) => {
                const segPct = barDenom > 0 ? (entry.used / barDenom) * 100 : 0;
                if (segPct < 0.3) return null;
                const color = BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length];
                return (
                  <Tooltip
                    key={entry.name + entry.type}
                    content={`${entry.name}: ${formatStorageSize(entry.used)}`}
                  >
                    <div
                      className='h-full transition-all cursor-default first:rounded-l-full'
                      style={{
                        width: `${segPct}%`,
                        backgroundColor: color,
                        minWidth: segPct > 0 ? 3 : 0,
                      }}
                    />
                  </Tooltip>
                );
              })
            : storageUsed > 0 && (
                <div
                  className='h-full rounded-full transition-all'
                  style={{
                    width: `${Math.max(storagePct, 1)}%`,
                    backgroundColor: '#3b82f6',
                  }}
                />
              )}
        </div>

        {nearLimit && (
          <p className='text-[10px] mt-1 text-warning'>Approaching limit</p>
        )}
        {!hasLimit && storageUsed === 0 && (
          <p className='text-xs text-default-400 mt-1'>No storage used.</p>
        )}

        {/* Breakdown list */}
        {storageBreakdown.length > 0 && (
          <div className='space-y-1.5 mt-3'>
            <p className='text-xs font-semibold text-default-400 uppercase tracking-wider'>
              Breakdown
            </p>
            {storageBreakdown.map((entry, i) => {
              const pct =
                storageUsed > 0 ? (entry.used / storageUsed) * 100 : 0;
              const color = BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length];
              return (
                <div
                  key={entry.name + entry.type}
                  className='flex items-center gap-2'
                >
                  <span
                    className='inline-block w-2.5 h-2.5 rounded-sm shrink-0'
                    style={{ backgroundColor: color }}
                  />
                  <span className='text-sm text-foreground flex-1 truncate'>
                    {entry.name}
                  </span>
                  <span className='text-xs text-default-400 shrink-0'>
                    {formatStorageSize(entry.used)}
                  </span>
                  <span className='text-xs text-default-400 shrink-0 w-12 text-right'>
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const [leaveError, setLeaveError] = useState<string | null>(null);
  const user = useChatStore((s) => s.user);
  const setSpaces = useChatStore((s) => s.setSpaces);
  const updateSpace = useChatStore((s) => s.updateSpace);
  const removeSpace = useChatStore((s) => s.removeSpace);

  const SPACE_RANK: Record<string, number> = {
    owner: 2,
    admin: 1,
    user: 0,
  };

  // Actor's effective rank is the higher of space role and server role
  const spaceRoleRank = SPACE_RANK[space.my_role] ?? 0;
  const serverRoleRank =
    user?.role === 'owner' ? 3 : user?.role === 'admin' ? 2 : 0;
  const actorRank = Math.max(spaceRoleRank, serverRoleRank);

  const canManage = actorRank >= SPACE_RANK['admin'];

  const memberIds = useMemo(
    () => space.members.map((m) => m.id),
    [space.members],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSpaceSettings(space.id, {
        name,
        description,
        is_public: isPublic,
        default_role: defaultRole,
        profile_color: profileColor,
      });
      updateSpace({ id: space.id, ...updated });
      setSavedPayload(
        JSON.stringify({
          name,
          description,
          isPublic,
          defaultRole,
          profileColor,
        }),
      );
    } catch (e) {
      console.error('Space operation failed:', e);
    }
    setSaving(false);
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      await api.changeSpaceMemberRole(space.id, userId, newRole);
      const spaces = await api.listSpaces();
      setSpaces(spaces);
    } catch (e) {
      console.error('Space operation failed:', e);
    }
  };

  const handleKick = async (member: SpaceMemberInfo) => {
    if (!confirm(`Remove ${member.display_name} from ${space.name}?`)) return;
    try {
      await api.kickFromSpace(space.id, member.id);
      const spaces = await api.listSpaces();
      setSpaces(spaces);
    } catch (e) {
      console.error('Space operation failed:', e);
    }
  };

  const handleInvite = async () => {
    if (inviteUserId.length === 0) return;
    setInviting(true);
    setInviteSent(false);
    setInviteError(null);
    try {
      await api.inviteToSpace(space.id, inviteUserId[0], inviteRole);
      setInviteUserId([]);
      setInviteSent(true);
      setTimeout(() => setInviteSent(false), 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send invite';
      setInviteError(msg);
    }
    setInviting(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAvatarMsg('Please select an image file');
      setTimeout(() => setAvatarMsg(''), 3000);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropConfirm = async () => {
    if (!cropImage || !croppedArea) return;

    setUploading(true);
    try {
      const blob = await getCroppedBlob(cropImage, croppedArea);
      const file = new File([blob], 'space-avatar.png', { type: 'image/png' });
      const updated = await api.uploadSpaceAvatar(space.id, file);
      updateSpace({ id: space.id, ...updated });
    } catch (e) {
      setAvatarMsg(e instanceof Error ? e.message : 'Upload failed');
      setTimeout(() => setAvatarMsg(''), 3000);
    } finally {
      setUploading(false);
      setCropImage(null);
    }
  };

  const handleCropCancel = () => {
    setCropImage(null);
  };

  const handleRemoveAvatar = async () => {
    setUploading(true);
    try {
      const updated = await api.deleteSpaceAvatar(space.id);
      updateSpace({ id: space.id, ...updated });
    } catch (e) {
      setAvatarMsg(e instanceof Error ? e.message : 'Failed to remove');
      setTimeout(() => setAvatarMsg(''), 3000);
    } finally {
      setUploading(false);
    }
  };

  const handleToggleTool = async (tool: SpaceToolName, enabled: boolean) => {
    setToolsLoading(tool);
    try {
      const result = await api.setSpaceTool(space.id, tool, enabled);
      const newTools = new Set(result.enabled_tools);
      setEnabledTools(newTools);
      updateSpace({ id: space.id, enabled_tools: result.enabled_tools });
    } catch (e) {
      console.error('Failed to toggle tool:', e);
    } finally {
      setToolsLoading(null);
    }
  };

  const AVAILABLE_TOOLS: {
    name: SpaceToolName;
    label: string;
    description: string;
    icon: typeof faFolderOpen;
    available: boolean;
  }[] = [
    {
      name: 'files',
      label: 'Files',
      description:
        'Shared file hosting with folders, permissions, and version history',
      icon: faFolderOpen,
      available: true,
    },
    {
      name: 'calendar',
      label: 'Calendar',
      description: 'Shared calendar for scheduling events',
      icon: faCalendar,
      available: true,
    },
    {
      name: 'tasks',
      label: 'Tasks',
      description: 'Kanban boards for task tracking and project management',
      icon: faListCheck,
      available: true,
    },
    {
      name: 'wiki',
      label: 'Wiki',
      description:
        'Collaborative documentation with rich text editing and version history',
      icon: faBook,
      available: true,
    },
    ...(space.is_personal
      ? [
          {
            name: 'minigames' as const,
            label: 'Minigames',
            description: "Puzzle games including PCB routing and Rubik's Cube",
            icon: faPuzzlePiece,
            available: true,
          },
        ]
      : []),
  ];

  return (
    <>
      <Modal
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        size='3xl'
        scrollBehavior='inside'
        backdrop='opaque'
      >
        <ModalContent>
          <ModalHeader>
            <div className='flex items-center gap-3'>
              <span>
                {space.is_personal
                  ? 'My Space'
                  : `Space Settings — ${space.name}`}
              </span>
              {isDirty && (
                <span className='text-xs font-normal text-warning bg-warning/10 px-2 py-0.5 rounded-full'>
                  Unsaved changes
                </span>
              )}
            </div>
          </ModalHeader>
          <ModalBody className='pb-6'>
            {space.is_personal ? (
              <Tabs color='primary' classNames={{ tabList: 'bg-content2' }}>
                <Tab key='tools' title='Tools'>
                  <div className='space-y-4 pt-2'>
                    <div className='text-sm text-default-500'>
                      Toggle the tools you want to use. Available tools are
                      managed by server administrators.
                    </div>
                    <div className='space-y-3'>
                      {AVAILABLE_TOOLS.filter(
                        (t) =>
                          t.available &&
                          (space.allowed_tools ?? []).includes(t.name),
                      ).map((tool) => (
                        <div
                          key={tool.name}
                          className='flex items-center gap-3 p-3 rounded-lg bg-content2'
                        >
                          <FontAwesomeIcon
                            icon={tool.icon}
                            className='text-default-500 w-5'
                          />
                          <div className='flex-1 min-w-0'>
                            <span className='text-sm font-medium text-foreground'>
                              {tool.label}
                            </span>
                            <p className='text-xs text-default-400 mt-0.5'>
                              {tool.description}
                            </p>
                          </div>
                          <Switch
                            size='sm'
                            isSelected={enabledTools.has(tool.name)}
                            isDisabled={toolsLoading === tool.name}
                            onValueChange={(checked) =>
                              handleToggleTool(tool.name, checked)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </Tab>
                <Tab key='storage' title='Storage'>
                  <div className='space-y-3 pt-2'>{renderStorageSection()}</div>
                </Tab>
              </Tabs>
            ) : (
              <Tabs color='primary' classNames={{ tabList: 'bg-content2' }}>
                {canManage && (
                  <Tab key='settings' title='Settings'>
                    <div className='space-y-4 pt-2'>
                      {/* Space avatar */}
                      <div className='flex items-center gap-4'>
                        <div className='relative group'>
                          <SpaceAvatar
                            name={space.name}
                            avatarFileId={space.avatar_file_id}
                            profileColor={profileColor || space.profile_color}
                            size='lg'
                          />
                          <button
                            type='button'
                            className='absolute inset-0 rounded-xl bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer'
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                          >
                            <FontAwesomeIcon
                              icon={faCamera}
                              className='text-white text-lg'
                            />
                          </button>
                          <input
                            ref={fileInputRef}
                            type='file'
                            accept='image/*'
                            className='hidden'
                            onChange={handleFileSelect}
                          />
                        </div>
                        <div className='flex flex-col gap-1'>
                          <Button
                            size='sm'
                            variant='flat'
                            onPress={() => fileInputRef.current?.click()}
                            isLoading={uploading}
                          >
                            {uploading ? 'Uploading...' : 'Change Picture'}
                          </Button>
                          {space.avatar_file_id && (
                            <Button
                              size='sm'
                              variant='light'
                              color='danger'
                              onPress={handleRemoveAvatar}
                              isLoading={uploading}
                              startContent={
                                <FontAwesomeIcon
                                  icon={faTrashCan}
                                  className='text-xs'
                                />
                              }
                            >
                              Remove
                            </Button>
                          )}
                          {avatarMsg && (
                            <span className='text-xs text-danger'>
                              {avatarMsg}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Background color picker (for default avatar) */}
                      <div>
                        <p className='text-sm text-default-600 mb-2'>
                          Background Color
                        </p>
                        <div className='flex flex-wrap gap-2'>
                          {[
                            '#e53e3e',
                            '#dd6b20',
                            '#d69e2e',
                            '#38a169',
                            '#319795',
                            '#3182ce',
                            '#5a67d8',
                            '#805ad5',
                            '#d53f8c',
                            '#718096',
                          ].map((color) => (
                            <button
                              key={color}
                              type='button'
                              className={`w-7 h-7 rounded-lg border-2 transition-all ${
                                profileColor === color
                                  ? 'border-foreground scale-110'
                                  : 'border-transparent hover:scale-105'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => setProfileColor(color)}
                            />
                          ))}
                          {profileColor && (
                            <button
                              type='button'
                              className='text-xs text-default-400 hover:text-foreground px-2'
                              onClick={() => setProfileColor('')}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                      <Input
                        label='Space Name'
                        variant='bordered'
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <Input
                        label='Description'
                        variant='bordered'
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                      <div className='flex items-center justify-between'>
                        <div>
                          <p className='text-sm font-medium text-foreground'>
                            Public Space
                          </p>
                          <p className='text-xs text-default-400'>
                            {isPublic
                              ? 'Anyone can find and join'
                              : 'Invite only'}
                          </p>
                        </div>
                        <Switch
                          isSelected={isPublic}
                          onValueChange={setIsPublic}
                          size='sm'
                        />
                      </div>
                      <Select
                        label='Default Role for New Members'
                        variant='bordered'
                        selectedKeys={[defaultRole]}
                        onChange={(e) =>
                          setDefaultRole(e.target.value as SpaceRole)
                        }
                      >
                        <SelectItem key='user'>User</SelectItem>
                      </Select>
                      <Button
                        color={isDirty ? 'warning' : 'primary'}
                        onPress={handleSave}
                        isLoading={saving}
                      >
                        {isDirty
                          ? 'Save Settings (unsaved changes)'
                          : 'Save Settings'}
                      </Button>
                    </div>
                  </Tab>
                )}

                <Tab key='members' title={`Members (${space.members.length})`}>
                  <div className='space-y-2 pt-2'>
                    {space.members.map((m) => (
                      <div
                        key={m.id}
                        className='flex items-center justify-between p-2 rounded-lg bg-content1'
                      >
                        <UserPopoverCard userId={m.id}>
                          <div className='flex items-center gap-2 min-w-0 cursor-pointer'>
                            <OnlineStatusDot
                              isOnline={m.is_online}
                              lastSeen={m.last_seen}
                            />
                            <span className='text-sm truncate hover:underline'>
                              {m.display_name}
                            </span>
                            <span className='text-xs text-default-400'>
                              @{m.username}
                            </span>
                          </div>
                        </UserPopoverCard>
                        {(() => {
                          const targetRank = SPACE_RANK[m.role] ?? 0;
                          const isSelf = m.id === user?.id;
                          const canEditMember =
                            canManage && (targetRank < actorRank || isSelf);
                          const roleItems = [
                            { key: 'owner', label: 'Owner', rank: 2 },
                            { key: 'admin', label: 'Admin', rank: 1 },
                            { key: 'user', label: 'User', rank: 0 },
                          ].filter((r) => r.rank <= actorRank);
                          return canEditMember ? (
                            <div className='flex items-center gap-2 flex-shrink-0'>
                              <Select
                                size='sm'
                                variant='bordered'
                                className='w-28'
                                selectedKeys={[m.role]}
                                onChange={(e) =>
                                  handleChangeRole(m.id, e.target.value)
                                }
                                aria-label='Role'
                                items={roleItems}
                              >
                                {(item) => (
                                  <SelectItem key={item.key}>
                                    {item.label}
                                  </SelectItem>
                                )}
                              </Select>
                              {!isSelf && (
                                <Button
                                  size='sm'
                                  variant='flat'
                                  color='danger'
                                  onPress={() => handleKick(m)}
                                >
                                  Kick
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className='text-xs text-default-400 flex-shrink-0 capitalize'>
                              {m.role}
                            </span>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </Tab>

                {canManage && (
                  <Tab key='invite' title='Invite'>
                    <div className='space-y-4 pt-2'>
                      <UserPicker
                        mode='single'
                        selected={inviteUserId}
                        onChange={setInviteUserId}
                        excludeIds={memberIds}
                        label='Select user'
                        placeholder='Search users...'
                      />
                      <Select
                        label='Role'
                        variant='bordered'
                        selectedKeys={[inviteRole]}
                        onChange={(e) => setInviteRole(e.target.value)}
                      >
                        <SelectItem key='admin'>Admin</SelectItem>
                        <SelectItem key='user'>User</SelectItem>
                      </Select>
                      <Button
                        color='primary'
                        onPress={handleInvite}
                        isLoading={inviting}
                        isDisabled={inviteUserId.length === 0}
                      >
                        Send Invite
                      </Button>
                      {inviteSent && (
                        <p className='text-xs text-success'>
                          Invite sent successfully!
                        </p>
                      )}
                      {inviteError && (
                        <p className='text-xs text-danger'>{inviteError}</p>
                      )}
                    </div>
                  </Tab>
                )}

                {canManage && (
                  <Tab key='tools' title='Tools'>
                    <div className='space-y-3 pt-2'>
                      <p className='text-xs text-default-400'>
                        Enable tools to add functionality to this space.
                      </p>
                      {AVAILABLE_TOOLS.map((tool) => (
                        <div
                          key={tool.name}
                          className='flex items-center gap-3 p-3 rounded-lg bg-content2'
                        >
                          <FontAwesomeIcon
                            icon={tool.icon}
                            className='text-default-500 w-5'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='flex items-center gap-2'>
                              <span className='text-sm font-medium text-foreground'>
                                {tool.label}
                              </span>
                              {!tool.available && (
                                <span className='text-[10px] bg-default-100 text-default-400 px-1.5 py-0.5 rounded'>
                                  Coming soon
                                </span>
                              )}
                            </div>
                            <p className='text-xs text-default-400 mt-0.5'>
                              {tool.description}
                            </p>
                          </div>
                          <Switch
                            size='sm'
                            isSelected={enabledTools.has(tool.name)}
                            isDisabled={
                              !tool.available || toolsLoading === tool.name
                            }
                            onValueChange={(checked) =>
                              handleToggleTool(tool.name, checked)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </Tab>
                )}

                <Tab key='storage' title='Storage'>
                  <div className='space-y-3 pt-2'>{renderStorageSection()}</div>
                </Tab>
              </Tabs>
            )}

            {!space.is_personal && (
              <div className='border-t border-divider pt-4 mt-2 space-y-3'>
                {leaveError && (
                  <p className='text-xs text-danger'>{leaveError}</p>
                )}
                <div className='flex gap-2'>
                  <Button
                    variant='flat'
                    color='warning'
                    onPress={async () => {
                      try {
                        setLeaveError(null);
                        await api.leaveSpace(space.id);
                        removeSpace(space.id);
                        onClose();
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : 'Failed';
                        setLeaveError(msg);
                      }
                    }}
                  >
                    Leave Space
                  </Button>
                  {canManage && !space.is_archived && (
                    <Button
                      variant='flat'
                      color='danger'
                      onPress={async () => {
                        if (
                          !confirm(
                            `Archive ${space.name}? All channels will be archived.`,
                          )
                        )
                          return;
                        try {
                          await api.archiveSpace(space.id);
                          updateSpace({
                            id: space.id,
                            is_archived: true,
                          });
                        } catch (e) {
                          console.error('Space archive failed:', e);
                        }
                      }}
                    >
                      Archive Space
                    </Button>
                  )}
                  {canManage && space.is_archived && (
                    <Button
                      variant='flat'
                      color='success'
                      onPress={async () => {
                        try {
                          await api.unarchiveSpace(space.id);
                          updateSpace({
                            id: space.id,
                            is_archived: false,
                          });
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : 'Failed';
                          setLeaveError(msg);
                        }
                      }}
                    >
                      Unarchive Space
                    </Button>
                  )}
                </div>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Crop Modal */}
      <Modal
        isOpen={!!cropImage}
        onOpenChange={(open) => !open && handleCropCancel()}
        size='lg'
        backdrop='opaque'
      >
        <ModalContent>
          <ModalHeader>Crop Space Picture</ModalHeader>
          <ModalBody>
            <div className='relative w-full' style={{ height: 350 }}>
              {cropImage && (
                <Cropper
                  image={cropImage}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape='rect'
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              )}
            </div>
            <div className='flex items-center gap-3 px-2'>
              <span className='text-xs text-default-500 whitespace-nowrap'>
                Zoom
              </span>
              <Slider
                size='sm'
                step={0.1}
                minValue={1}
                maxValue={3}
                value={zoom}
                onChange={(v) => setZoom(v as number)}
                className='flex-1'
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='flat' onPress={handleCropCancel}>
              Cancel
            </Button>
            <Button
              color='primary'
              onPress={handleCropConfirm}
              isLoading={uploading}
            >
              {uploading ? 'Uploading...' : 'Confirm'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
