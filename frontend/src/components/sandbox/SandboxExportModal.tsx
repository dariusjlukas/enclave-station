import { useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload, faServer } from '@fortawesome/free-solid-svg-icons';
import { v86Manager } from '../../services/v86Manager';
import * as api from '../../services/api';
import type { SpaceFile } from '../../types';
import { ServerFilePicker } from './ServerFilePicker';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SandboxExportModal({ isOpen, onClose }: Props) {
  const [vmPath, setVmPath] = useState('/root/');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const getFileName = () => {
    const parts = vmPath.split('/');
    return parts[parts.length - 1] || 'file';
  };

  const readFileFromVm = async (): Promise<Uint8Array> => {
    return v86Manager.readFile(vmPath);
  };

  const handleDownloadLocal = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await readFileFromVm();
      const blob = new Blob([data.buffer.slice(0) as ArrayBuffer]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getFileName();
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    }
    setLoading(false);
  };

  const handleUploadToServer = () => {
    setError('');
    setShowFolderPicker(true);
  };

  const handleServerFolderSelected = async (
    targetSpaceId: string,
    folder: SpaceFile,
  ) => {
    setShowFolderPicker(false);
    setLoading(true);
    setError('');
    try {
      const data = await readFileFromVm();
      const blob = new Blob([data.buffer.slice(0) as ArrayBuffer], {
        type: 'application/octet-stream',
      });
      const file = new File([blob], getFileName(), {
        type: 'application/octet-stream',
      });
      await api.uploadSpaceFile(targetSpaceId, file, folder.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export');
    }
    setLoading(false);
  };

  return (
    <>
      <Modal
        isOpen={isOpen && !showFolderPicker}
        onOpenChange={(open) => !open && onClose()}
        size='md'
      >
        <ModalContent>
          <ModalHeader>Export File from Sandbox</ModalHeader>
          <ModalBody>
            <Input
              label='File path in VM'
              placeholder='/root/myfile.txt'
              value={vmPath}
              onValueChange={(v) => {
                setVmPath(v);
                setError('');
              }}
              description='Full path to the file inside the sandbox'
            />
            {error && <p className='text-danger text-xs'>{error}</p>}
            <div className='flex flex-col gap-2 mt-2'>
              <Button
                color='primary'
                variant='flat'
                isLoading={loading}
                onPress={handleDownloadLocal}
                startContent={!loading && <FontAwesomeIcon icon={faDownload} />}
                fullWidth
              >
                Download to Computer
              </Button>
              <Button
                color='primary'
                isLoading={loading}
                onPress={handleUploadToServer}
                startContent={!loading && <FontAwesomeIcon icon={faServer} />}
                fullWidth
              >
                Save to Server Files
              </Button>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='flat' onPress={onClose}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ServerFilePicker
        isOpen={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={handleServerFolderSelected}
        title='Select Destination Folder'
        selectFolderMode
      />
    </>
  );
}
