import { useState, useRef } from 'react';
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
import { faLaptop, faServer } from '@fortawesome/free-solid-svg-icons';
import { v86Manager } from '../../services/v86Manager';
import * as api from '../../services/api';
import type { SpaceFile } from '../../types';
import { ServerFilePicker } from './ServerFilePicker';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onStatus: (msg: string) => void;
}

export function SandboxImportModal({ isOpen, onClose, onStatus }: Props) {
  const [showServerPicker, setShowServerPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [vmDir, setVmDir] = useState('/root/');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const normalizeDir = (dir: string) => {
    const d = dir.endsWith('/') ? dir : dir + '/';
    return d.startsWith('/') ? d : '/' + d;
  };

  const importFileToVm = async (fileName: string, data: ArrayBuffer) => {
    const vmPath = normalizeDir(vmDir) + fileName;
    onStatus(`Importing ${fileName}...`);
    try {
      await v86Manager.createFile(vmPath, data);
      onStatus(`Imported ${fileName} to ${vmPath}`);
    } catch (err) {
      onStatus(
        `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  };

  const handleLocalFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    setLoading(true);
    onClose();
    for (const file of Array.from(fileList)) {
      const data = await file.arrayBuffer();
      await importFileToVm(file.name, data);
    }
    setLoading(false);
  };

  const handleServerFileSelected = async (
    sourceSpaceId: string,
    file: SpaceFile,
  ) => {
    setShowServerPicker(false);
    setLoading(true);
    onClose();
    const url = api.getSpaceFileDownloadUrl(sourceSpaceId, file.id);
    onStatus(`Downloading ${file.name}...`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download failed');
      const data = await response.arrayBuffer();
      await importFileToVm(file.name, data);
    } catch (err) {
      onStatus(
        `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
    setLoading(false);
  };

  return (
    <>
      <Modal
        isOpen={isOpen && !showServerPicker}
        onOpenChange={(open) => !open && onClose()}
        size='md'
      >
        <ModalContent>
          <ModalHeader>Import File to Sandbox</ModalHeader>
          <ModalBody>
            <Input
              label='Destination folder in VM'
              placeholder='/root/'
              value={vmDir}
              onValueChange={setVmDir}
              description='Folder path where files will be placed'
            />
            <div className='flex flex-col gap-2 mt-2'>
              <Button
                color='primary'
                variant='flat'
                isLoading={loading}
                onPress={() => fileInputRef.current?.click()}
                startContent={!loading && <FontAwesomeIcon icon={faLaptop} />}
                fullWidth
              >
                From Computer
              </Button>
              <Button
                color='primary'
                isLoading={loading}
                onPress={() => setShowServerPicker(true)}
                startContent={!loading && <FontAwesomeIcon icon={faServer} />}
                fullWidth
              >
                From Server Files
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

      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={handleLocalFiles}
      />

      <ServerFilePicker
        isOpen={showServerPicker}
        onClose={() => setShowServerPicker(false)}
        onSelect={handleServerFileSelected}
        title='Import File from Server'
      />
    </>
  );
}
