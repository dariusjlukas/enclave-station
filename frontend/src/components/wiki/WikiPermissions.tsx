import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Spinner,
  Tabs,
  Tab,
} from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus, faUserMinus } from '@fortawesome/free-solid-svg-icons';
import * as api from '../../services/api';
import type { WikiPermission, WikiPagePermission } from '../../types';
import { useChatStore } from '../../stores/chatStore';

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
  const members = space?.members || [];

  const isOwner = myPermission === 'owner';

  // Space-level permissions
  const [spacePerms, setSpacePerms] = useState<WikiPermission[]>([]);
  const [loadingSpace, setLoadingSpace] = useState(true);
  const [spaceUserId, setSpaceUserId] = useState('');
  const [spacePermLevel, setSpacePermLevel] = useState('edit');

  // Page-level permissions
  const [pagePerms, setPagePerms] = useState<WikiPagePermission[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [pageUserId, setPageUserId] = useState('');
  const [pagePermLevel, setPagePermLevel] = useState('edit');

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

  // Space-level handlers
  const handleAddSpace = async () => {
    if (!spaceUserId) return;
    try {
      await api.setWikiPermission(spaceId, spaceUserId, spacePermLevel);
      setSpaceUserId('');
      loadSpacePermissions();
    } catch {
      // ignore
    }
  };

  const handleRemoveSpace = async (userId: string) => {
    try {
      await api.removeWikiPermission(spaceId, userId);
      loadSpacePermissions();
    } catch {
      // ignore
    }
  };

  // Page-level handlers
  const handleAddPage = async () => {
    if (!pageUserId || !pageId) return;
    try {
      await api.setWikiPagePermission(
        spaceId,
        pageId,
        pageUserId,
        pagePermLevel,
      );
      setPageUserId('');
      loadPagePermissions();
    } catch {
      // ignore
    }
  };

  const handleRemovePage = async (userId: string) => {
    if (!pageId) return;
    try {
      await api.removeWikiPagePermission(spaceId, pageId, userId);
      loadPagePermissions();
    } catch {
      // ignore
    }
  };

  const spacePermUserIds = new Set(spacePerms.map((p) => p.user_id));
  const availableSpaceMembers = members.filter(
    (m) => !spacePermUserIds.has(m.id),
  );

  const pagePermUserIds = new Set(pagePerms.map((p) => p.user_id));
  const availablePageMembers = members.filter(
    (m) => !pagePermUserIds.has(m.id),
  );

  const renderPermissionRow = (
    p: {
      user_id: string;
      username: string;
      display_name: string;
      permission: string;
    },
    onRemove: (userId: string) => void,
  ) => (
    <div
      key={p.user_id}
      className='flex items-center justify-between px-3 py-2 rounded-lg bg-content2'
    >
      <div>
        <span className='text-sm font-medium'>
          {p.display_name || p.username}
        </span>
        <span className='text-xs text-default-400 ml-2'>@{p.username}</span>
      </div>
      <div className='flex items-center gap-2'>
        <span className='text-xs px-2 py-0.5 rounded-full bg-default-100 capitalize'>
          {p.permission}
        </span>
        {isOwner && (
          <Button
            isIconOnly
            variant='light'
            size='sm'
            color='danger'
            onPress={() => onRemove(p.user_id)}
            title='Remove permission'
          >
            <FontAwesomeIcon icon={faUserMinus} className='text-xs' />
          </Button>
        )}
      </div>
    </div>
  );

  const renderAddForm = (
    availableMembers: { id: string; username: string; display_name?: string }[],
    selectedUserId: string,
    setSelectedUserId: (v: string) => void,
    selectedPerm: string,
    setSelectedPerm: (v: string) => void,
    onAdd: () => void,
  ) => {
    if (!isOwner || availableMembers.length === 0) return null;
    return (
      <div className='flex items-end gap-2 mt-3'>
        <div className='flex-1'>
          <label className='text-xs font-semibold text-default-500 block mb-1'>
            Add User
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className='w-full px-3 py-2 rounded-lg bg-content2 border border-divider text-sm'
          >
            <option value=''>Select a member...</option>
            {availableMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name || m.username} (@{m.username})
              </option>
            ))}
          </select>
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
            <option value='view'>View</option>
            <option value='edit'>Edit</option>
            <option value='owner'>Owner</option>
          </select>
        </div>
        <Button
          size='sm'
          color='primary'
          startContent={
            <FontAwesomeIcon icon={faUserPlus} className='text-xs' />
          }
          onPress={onAdd}
          isDisabled={!selectedUserId}
        >
          Add
        </Button>
      </div>
    );
  };

  const renderSpaceTab = () => (
    <div>
      <p className='text-sm text-default-500 mb-3'>
        Control who can view and edit wiki pages in this space. By default,
        permissions follow space roles.
      </p>

      {loadingSpace ? (
        <div className='flex justify-center py-6'>
          <Spinner size='sm' />
        </div>
      ) : (
        <>
          <div className='space-y-2'>
            {spacePerms.map((p) => renderPermissionRow(p, handleRemoveSpace))}
            {spacePerms.length === 0 && (
              <p className='text-sm text-default-400 text-center py-4'>
                No custom permissions set. Using space defaults.
              </p>
            )}
          </div>
          {renderAddForm(
            availableSpaceMembers,
            spaceUserId,
            setSpaceUserId,
            spacePermLevel,
            setSpacePermLevel,
            handleAddSpace,
          )}
        </>
      )}
    </div>
  );

  const renderPageTab = () => {
    if (!pageId) {
      return (
        <p className='text-sm text-default-400 text-center py-6'>
          Select a page to manage page-level permissions.
        </p>
      );
    }
    return (
      <div>
        <p className='text-sm text-default-500 mb-3'>
          Override space-level permissions for this specific page.
        </p>

        {loadingPage ? (
          <div className='flex justify-center py-6'>
            <Spinner size='sm' />
          </div>
        ) : (
          <>
            <div className='space-y-2'>
              {pagePerms.map((p) => renderPermissionRow(p, handleRemovePage))}
              {pagePerms.length === 0 && (
                <p className='text-sm text-default-400 text-center py-4'>
                  No page-level permissions set. Using space-level defaults.
                </p>
              )}
            </div>
            {renderAddForm(
              availablePageMembers,
              pageUserId,
              setPageUserId,
              pagePermLevel,
              setPagePermLevel,
              handleAddPage,
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size='lg' scrollBehavior='inside'>
      <ModalContent>
        <ModalHeader>Wiki Permissions</ModalHeader>
        <ModalBody>
          {pageId ? (
            <Tabs aria-label='Permission scope' variant='underlined'>
              <Tab key='space' title='Space-level'>
                {renderSpaceTab()}
              </Tab>
              <Tab key='page' title='Page-level'>
                {renderPageTab()}
              </Tab>
            </Tabs>
          ) : (
            renderSpaceTab()
          )}
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
