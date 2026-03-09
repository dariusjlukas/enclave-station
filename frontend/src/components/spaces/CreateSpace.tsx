import { useState, useRef, useCallback } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Switch,
  Select,
  SelectItem,
  Alert,
  Slider,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera } from '@fortawesome/free-solid-svg-icons';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import * as api from '../../services/api';
import { useChatStore } from '../../stores/chatStore';
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

interface Props {
  onClose: () => void;
}

export function CreateSpace({ onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [defaultRole, setDefaultRole] = useState('write');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setActiveView = useChatStore((s) => s.setActiveView);

  // Avatar state — stored as a cropped blob to upload after creation
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop state
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) return;

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

    try {
      const blob = await getCroppedBlob(cropImage, croppedArea);
      setAvatarBlob(blob);
      setAvatarPreview(URL.createObjectURL(blob));
    } catch {
      // ignore crop errors
    } finally {
      setCropImage(null);
    }
  };

  const handleCropCancel = () => {
    setCropImage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Space name is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const space = await api.createSpace(
        name.trim(),
        description.trim(),
        isPublic,
        defaultRole,
      );

      // Upload avatar if one was selected
      if (avatarBlob) {
        const file = new File([avatarBlob], 'space-avatar.png', {
          type: 'image/png',
        });
        await api.uploadSpaceAvatar(space.id, file);
      }

      const spaces = await api.listSpaces();
      useChatStore.getState().setSpaces(spaces);
      setActiveView({ type: 'space', spaceId: space.id });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        size='md'
        backdrop='opaque'
      >
        <ModalContent>
          <form onSubmit={handleSubmit}>
            <ModalHeader>Create Space</ModalHeader>
            <ModalBody>
              {error && (
                <Alert color='danger' variant='flat'>
                  {error}
                </Alert>
              )}
              {/* Space avatar */}
              <div className='flex items-center gap-4'>
                <div className='relative group'>
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt='Space avatar'
                      className='w-16 h-16 rounded-xl object-cover flex-shrink-0'
                    />
                  ) : (
                    <SpaceAvatar name={name || '?'} size='lg' />
                  )}
                  <button
                    type='button'
                    className='absolute inset-0 rounded-xl bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer'
                    onClick={() => fileInputRef.current?.click()}
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
                  >
                    {avatarPreview ? 'Change Picture' : 'Add Picture'}
                  </Button>
                  {avatarPreview && (
                    <Button
                      size='sm'
                      variant='light'
                      color='danger'
                      onPress={() => {
                        setAvatarBlob(null);
                        setAvatarPreview(null);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <Input
                label='Space Name'
                variant='bordered'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. Engineering'
              />
              <Input
                label='Description'
                description='Optional'
                variant='bordered'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this space for?"
              />
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-sm font-medium text-foreground'>
                    Public Space
                  </p>
                  <p className='text-xs text-default-400'>
                    {isPublic ? 'Anyone can find and join' : 'Invite only'}
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
                onChange={(e) => setDefaultRole(e.target.value)}
              >
                <SelectItem key='write'>Write (can send messages)</SelectItem>
                <SelectItem key='read'>Read Only (can view only)</SelectItem>
              </Select>
            </ModalBody>
            <ModalFooter>
              <Button variant='light' color='default' onPress={onClose}>
                Cancel
              </Button>
              <Button type='submit' color='primary' isLoading={loading}>
                Create Space
              </Button>
            </ModalFooter>
          </form>
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
            <Button color='primary' onPress={handleCropConfirm}>
              Confirm
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
