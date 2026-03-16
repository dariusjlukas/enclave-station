import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Tabs,
  Tab,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShield } from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { WikiPermission, WikiPagePermission } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import {
  PermissionEditor,
  PermissionEditorContent,
} from '../common/PermissionEditor';

interface Props {
  spaceId: string;
  pageId?: string;
  isOpen: boolean;
  onClose: () => void;
  myPermission: string;
}

export function WikiPermissions({
  spaceId,
  pageId,
  isOpen,
  onClose,
  myPermission,
}: Props) {
  const spaces = useChatStore((s) => s.spaces);
  const space = spaces.find((s) => s.id === spaceId);
  const isOwner = myPermission === 'owner';

  const [spacePerms, setSpacePerms] = useState<WikiPermission[]>([]);
  const [loadingSpace, setLoadingSpace] = useState(true);
  const [pagePerms, setPagePerms] = useState<WikiPagePermission[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);

  const loadSpacePermissions = useCallback(async () => {
    try {
      const { permissions } = await api.getWikiPermissions(spaceId);
      setSpacePerms(permissions);
    } catch {
      // ignore
    } finally {
      setLoadingSpace(false);
    }
  }, [spaceId]);

  const loadPagePermissions = useCallback(async () => {
    if (!pageId) {
      setLoadingPage(false);
      return;
    }
    try {
      const { permissions } = await api.getWikiPagePermissions(spaceId, pageId);
      setPagePerms(permissions);
    } catch {
      // ignore
    } finally {
      setLoadingPage(false);
    }
  }, [spaceId, pageId]);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingSpace(true);
    setLoadingPage(true);
    loadSpacePermissions();
    loadPagePermissions();
  }, [isOpen, spaceId, pageId, loadSpacePermissions, loadPagePermissions]);

  const availableUsers = (space?.members || []).map((m) => ({
    id: m.id,
    username: m.username,
    display_name: m.display_name,
  }));

  const commonProps = {
    availableUsers,
    canManage: isOwner,
    hideOwnerLevel: space?.is_personal,
    searchAllUsers: space?.is_personal,
  } as const;

  // No page selected — simple single-level modal
  if (!pageId) {
    return (
      <PermissionEditor
        title='Wiki Permissions'
        description='Control who can view and edit wiki pages in this space. Space admins and owners always have full access.'
        isOpen={isOpen}
        onClose={onClose}
        permissions={spacePerms}
        loading={loadingSpace}
        onSet={async (userId, permission) => {
          await api.setWikiPermission(spaceId, userId, permission);
          await loadSpacePermissions();
        }}
        onRemove={async (userId) => {
          await api.removeWikiPermission(spaceId, userId);
          await loadSpacePermissions();
        }}
        {...commonProps}
      />
    );
  }

  // With page — tabbed view with space-level and page-level
  return (
    <Modal isOpen={isOpen} onClose={onClose} size='lg' scrollBehavior='inside'>
      <ModalContent>
        <ModalHeader className='flex items-center gap-2'>
          <FontAwesomeIcon icon={faShield} className='text-primary' />
          Wiki Permissions
        </ModalHeader>
        <ModalBody>
          <Tabs aria-label='Permission scope' variant='underlined'>
            <Tab key='space' title='Space-level'>
              <PermissionEditorContent
                description='Control who can view and edit wiki pages in this space. Space admins and owners always have full access.'
                permissions={spacePerms}
                loading={loadingSpace}
                onSet={async (userId, permission) => {
                  await api.setWikiPermission(spaceId, userId, permission);
                  await loadSpacePermissions();
                }}
                onRemove={async (userId) => {
                  await api.removeWikiPermission(spaceId, userId);
                  await loadSpacePermissions();
                }}
                {...commonProps}
              />
            </Tab>
            <Tab key='page' title='Page-level'>
              <PermissionEditorContent
                description='Set permissions for this specific page. These apply in addition to space-level permissions.'
                permissions={pagePerms}
                loading={loadingPage}
                onSet={async (userId, permission) => {
                  await api.setWikiPagePermission(
                    spaceId,
                    pageId,
                    userId,
                    permission,
                  );
                  await loadPagePermissions();
                }}
                onRemove={async (userId) => {
                  await api.removeWikiPagePermission(spaceId, pageId, userId);
                  await loadPagePermissions();
                }}
                {...commonProps}
              />
            </Tab>
          </Tabs>
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
