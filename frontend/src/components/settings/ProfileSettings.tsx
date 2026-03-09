import { useState, useRef, useCallback } from 'react';
import {
  Button,
  Input,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Slider,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faTrashCan } from '@fortawesome/free-solid-svg-icons';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { useChatStore } from '../../stores/chatStore';
import { UserAvatar } from '../common/UserAvatar';
import * as api from '../../services/api';

const COLOR_OPTIONS = [
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
];

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

export function ProfileSettings() {
  const user = useChatStore((s) => s.user);
  const updateUser = useChatStore((s) => s.updateUser);
  const updateUserInList = useChatStore((s) => s.updateUserInList);

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [status, setStatus] = useState(user?.status || '');
  const [profileColor, setProfileColor] = useState(user?.profile_color || '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop state
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg('');
    try {
      const updated = await api.updateProfile({
        display_name: displayName.trim(),
        bio: bio.trim(),
        status: status.trim(),
        profile_color: profileColor,
      });
      updateUser(updated);
      if (user) updateUserInList(user.id, updated);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setSaveMsg('Please select an image file');
      setTimeout(() => setSaveMsg(''), 3000);
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
      const file = new File([blob], 'avatar.png', { type: 'image/png' });
      const updated = await api.uploadAvatar(file);
      updateUser(updated);
      if (user) updateUserInList(user.id, updated);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Upload failed');
      setTimeout(() => setSaveMsg(''), 3000);
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
      const updated = await api.deleteAvatar();
      updateUser(updated);
      if (user) updateUserInList(user.id, updated);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Failed to remove');
      setTimeout(() => setSaveMsg(''), 3000);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSaveProfile} className='space-y-4'>
        {/* Avatar section */}
        <div className='flex items-center gap-4'>
          <div className='relative group'>
            <UserAvatar
              username={user?.username || '?'}
              avatarFileId={user?.avatar_file_id}
              profileColor={user?.profile_color}
              size='lg'
            />
            <button
              type='button'
              className='absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer'
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <FontAwesomeIcon icon={faCamera} className='text-white text-lg' />
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
              {uploading ? 'Uploading...' : 'Change Avatar'}
            </Button>
            {user?.avatar_file_id && (
              <Button
                size='sm'
                variant='light'
                color='danger'
                onPress={handleRemoveAvatar}
                isLoading={uploading}
                startContent={
                  <FontAwesomeIcon icon={faTrashCan} className='text-xs' />
                }
              >
                Remove
              </Button>
            )}
          </div>
        </div>

        {/* Profile color picker (for default avatar) */}
        <div>
          <p className='text-sm text-default-600 mb-2'>Avatar Color</p>
          <div className='flex flex-wrap gap-2'>
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                type='button'
                className={`w-7 h-7 rounded-full border-2 transition-all ${
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
          label='Display Name'
          variant='bordered'
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Input
          label='Status'
          variant='bordered'
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          maxLength={100}
          placeholder='What are you up to?'
        />
        <Textarea
          label='Bio'
          variant='bordered'
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          minRows={3}
          placeholder='Tell us about yourself'
        />
        <div className='flex items-center gap-3'>
          <Button type='submit' color='primary' isLoading={saving} size='sm'>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          {saveMsg && (
            <span
              className={`text-sm ${saveMsg === 'Saved' ? 'text-success' : 'text-danger'}`}
            >
              {saveMsg}
            </span>
          )}
        </div>
      </form>

      {/* Crop Modal */}
      <Modal
        isOpen={!!cropImage}
        onOpenChange={(open) => !open && handleCropCancel()}
        size='lg'
        backdrop='opaque'
      >
        <ModalContent>
          <ModalHeader>Crop Avatar</ModalHeader>
          <ModalBody>
            <div className='relative w-full' style={{ height: 350 }}>
              {cropImage && (
                <Cropper
                  image={cropImage}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape='round'
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
