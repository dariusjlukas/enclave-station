import { useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, Button, Input, Textarea, Alert, Divider, Select, SelectItem } from '@heroui/react';
import { useChatStore } from '../../stores/chatStore';
import { clearKeys } from '../../services/crypto';
import * as api from '../../services/api';
import { DeviceManager } from './DeviceManager';
import { useTheme, COLOR_THEMES, type ColorTheme, type ModeSetting } from '../../hooks/useTheme';

interface Props {
  onClose: () => void;
}

export function UserSettings({ onClose }: Props) {
  const user = useChatStore((s) => s.user);
  const updateUser = useChatStore((s) => s.updateUser);
  const clearAuth = useChatStore((s) => s.clearAuth);

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [status, setStatus] = useState(user?.status || '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const { colorTheme, modeSetting, setColorTheme, setModeSetting } = useTheme();

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');
    try {
      const updated = await api.updateProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
        status: status.trim(),
      });
      updateUser({
        display_name: updated.display_name,
        bio: updated.bio,
        status: updated.status,
      });
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e: any) {
      setSaveMsg(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKeys = async () => {
    if (confirm('This will delete your keys from this browser. You will need a new invite to re-register. Continue?')) {
      await clearKeys(user?.username);
      clearAuth();
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== user?.username) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteAccount();
      await clearKeys(user?.username);
      clearAuth();
    } catch (e: any) {
      setDeleteError(e.message || 'Failed to delete account');
      setDeleting(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }} size="lg" scrollBehavior="inside" backdrop="opaque">
      <ModalContent>
        <ModalHeader>Settings</ModalHeader>
        <ModalBody className="pb-6">
          {/* Profile Section */}
          <section>
            <h3 className="text-lg font-semibold text-foreground mb-3">Profile</h3>
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <Input
                label="Display Name"
                variant="bordered"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <Input
                label="Status"
                variant="bordered"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                maxLength={100}
                placeholder="What are you up to?"
              />
              <Textarea
                label="Bio"
                variant="bordered"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                minRows={3}
                placeholder="Tell us about yourself"
              />
              <div className="flex items-center gap-3">
                <Button type="submit" color="primary" isLoading={saving} size="sm">
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                {saveMsg && (
                  <span className={`text-sm ${saveMsg === 'Saved' ? 'text-success' : 'text-danger'}`}>
                    {saveMsg}
                  </span>
                )}
              </div>
            </form>
          </section>

          <Divider className="my-4" />

          {/* Appearance Section */}
          <section>
            <h3 className="text-lg font-semibold text-foreground mb-3">Appearance</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <Select
                label="Color Theme"
                variant="bordered"
                selectedKeys={[colorTheme]}
                onChange={(e) => {
                  if (e.target.value) setColorTheme(e.target.value as ColorTheme);
                }}
                className="flex-1"
              >
                {COLOR_THEMES.map(({ key, label }) => (
                  <SelectItem key={key}>{label}</SelectItem>
                ))}
              </Select>
              <Select
                label="Mode"
                variant="bordered"
                selectedKeys={[modeSetting]}
                onChange={(e) => {
                  if (e.target.value) setModeSetting(e.target.value as ModeSetting);
                }}
                className="flex-1"
              >
                <SelectItem key="auto">Auto</SelectItem>
                <SelectItem key="light">Light</SelectItem>
                <SelectItem key="dark">Dark</SelectItem>
              </Select>
            </div>
          </section>

          <Divider className="my-4" />

          {/* Devices Section */}
          <section>
            <h3 className="text-lg font-semibold text-foreground mb-3">Devices</h3>
            <DeviceManager />
          </section>

          <Divider className="my-4" />

          {/* Danger Zone */}
          <section>
            <h3 className="text-lg font-semibold text-danger mb-3">Danger Zone</h3>
            <div className="space-y-4 border border-danger/30 rounded-lg p-4">
              <div>
                <p className="text-sm text-default-500 mb-2">
                  Remove your encryption keys from this browser. You will be logged out and need a device token to sign in again.
                </p>
                <Button color="danger" variant="bordered" size="sm" onPress={handleClearKeys}>
                  Clear Keys
                </Button>
              </div>
              <Divider />
              <div>
                <p className="text-sm text-default-500 mb-2">
                  Permanently delete your account and all associated data. This cannot be undone.
                </p>
                {deleteError && (
                  <Alert color="danger" variant="flat" className="mb-2">{deleteError}</Alert>
                )}
                <div className="flex gap-2">
                  <Input
                    size="sm"
                    variant="bordered"
                    color="danger"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={`Type "${user?.username}" to confirm`}
                    className="flex-1"
                  />
                  <Button
                    color="danger"
                    size="sm"
                    isDisabled={deleteConfirm !== user?.username}
                    isLoading={deleting}
                    onPress={handleDeleteAccount}
                  >
                    {deleting ? 'Deleting...' : 'Delete Account'}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
