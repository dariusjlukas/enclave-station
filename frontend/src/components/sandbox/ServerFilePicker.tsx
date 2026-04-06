import { useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Spinner,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faFile,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
import { useChatStore } from '../../stores/chatStore';
import * as api from '../../services/api';
import type { SpaceFile, SpaceFilePath } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (spaceId: string, file: SpaceFile) => void;
  title?: string;
  selectFolderMode?: boolean;
}

export function ServerFilePicker({
  isOpen,
  onClose,
  onSelect,
  title = 'Select File',
  selectFolderMode = false,
}: Props) {
  const spaces = useChatStore((s) => s.spaces);
  const spacesWithFiles = spaces.filter((s) =>
    s.enabled_tools?.includes('files'),
  );
  const defaultSpaceId = spacesWithFiles[0]?.id ?? null;

  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [files, setFiles] = useState<SpaceFile[]>([]);
  const [path, setPath] = useState<SpaceFilePath[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SpaceFile | null>(null);

  const activeSpaceId = selectedSpaceId ?? defaultSpaceId;

  const loadFiles = async (spaceId?: string | null, pid?: string) => {
    const sid = spaceId ?? activeSpaceId;
    if (!sid) return;
    setLoading(true);
    try {
      const res = await api.listSpaceFiles(sid, pid);
      setFiles(res.files);
      setPath(res.path);
    } catch {
      setFiles([]);
      setPath([]);
    }
    setLoading(false);
  };

  const handleNavigate = (folderId: string) => {
    setSelectedFile(null);
    loadFiles(null, folderId);
  };

  const handleBreadcrumb = (pathItem?: SpaceFilePath) => {
    setSelectedFile(null);
    loadFiles(null, pathItem?.id);
  };

  const handleConfirm = () => {
    if (selectedFile && activeSpaceId) {
      onSelect(activeSpaceId, selectedFile);
      onClose();
    }
  };

  const handleClose = () => {
    setSelectedSpaceId(null);
    setSelectedFile(null);
    setFiles([]);
    setPath([]);
    onClose();
  };

  const handleOpen = () => {
    loadFiles();
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) handleOpen();
        else handleClose();
      }}
      size='lg'
    >
      <ModalContent>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody>
          {/* Space selector */}
          {spacesWithFiles.length > 1 && (
            <div className='flex gap-2 mb-2'>
              {spacesWithFiles.map((s) => (
                <Button
                  key={s.id}
                  size='sm'
                  variant={activeSpaceId === s.id ? 'solid' : 'flat'}
                  onPress={() => {
                    setSelectedSpaceId(s.id);
                    loadFiles(s.id);
                  }}
                >
                  {s.name}
                </Button>
              ))}
            </div>
          )}

          {/* Breadcrumb */}
          <div className='flex items-center gap-1 text-xs text-default-500 mb-2 flex-wrap'>
            <button
              onClick={() => handleBreadcrumb()}
              className='hover:text-foreground cursor-pointer'
            >
              Root
            </button>
            {path.map((p) => (
              <span key={p.id} className='flex items-center gap-1'>
                <FontAwesomeIcon icon={faChevronRight} className='text-[8px]' />
                <button
                  onClick={() => handleBreadcrumb(p)}
                  className='hover:text-foreground cursor-pointer'
                >
                  {p.name}
                </button>
              </span>
            ))}
          </div>

          {/* File list */}
          <div className='border border-default-200 rounded-lg overflow-auto max-h-72 min-h-40'>
            {loading ? (
              <div className='flex items-center justify-center h-40'>
                <Spinner size='sm' />
              </div>
            ) : files.length === 0 ? (
              <div className='flex items-center justify-center h-40 text-default-400 text-sm'>
                No files here
              </div>
            ) : (
              <div className='divide-y divide-default-100'>
                {files.map((file) => {
                  const isSelectable = selectFolderMode
                    ? file.is_folder
                    : !file.is_folder;
                  return (
                    <button
                      key={file.id}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors cursor-pointer ${
                        selectedFile?.id === file.id
                          ? 'bg-primary/20 text-primary'
                          : 'hover:bg-content2'
                      }`}
                      onClick={() => {
                        if (file.is_folder) {
                          handleNavigate(file.id);
                        } else if (isSelectable) {
                          setSelectedFile(file);
                        }
                      }}
                      onDoubleClick={() => {
                        if (!file.is_folder && isSelectable && activeSpaceId) {
                          onSelect(activeSpaceId, file);
                          onClose();
                        }
                      }}
                    >
                      <FontAwesomeIcon
                        icon={file.is_folder ? faFolder : faFile}
                        className={
                          file.is_folder ? 'text-warning' : 'text-default-400'
                        }
                      />
                      <span className='truncate'>{file.name}</span>
                      {file.is_folder && (
                        <FontAwesomeIcon
                          icon={faChevronRight}
                          className='text-[10px] text-default-300 ml-auto'
                        />
                      )}
                      {!file.is_folder && (
                        <span className='text-xs text-default-400 ml-auto'>
                          {formatSize(file.file_size)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='flat' onPress={handleClose}>
            Cancel
          </Button>
          <Button
            color='primary'
            isDisabled={!selectedFile}
            onPress={handleConfirm}
          >
            Select
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
