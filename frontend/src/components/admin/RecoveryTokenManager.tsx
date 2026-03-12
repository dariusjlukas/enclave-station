import { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardBody } from '@heroui/react';
import * as api from '../../services/api';
import { useChatStore } from '../../stores/chatStore';
import { UserPicker } from '../common/UserPicker';

export function RecoveryTokenManager() {
  const [tokens, setTokens] = useState<
    Array<{
      id: string;
      token: string;
      created_by: string;
      for_user: string;
      for_user_id: string;
      used: boolean;
      expires_at: string;
      created_at: string;
      used_at?: string;
    }>
  >([]);
  const [selectedUserId, setSelectedUserId] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const setUsers = useChatStore((s) => s.setUsers);

  const loadTokens = useCallback(async () => {
    try {
      const data = await api.listRecoveryTokens();
      setTokens(data);
    } catch (e) {
      console.error('Recovery token operation failed:', e);
    }
  }, []);

  useEffect(() => {
    api
      .listRecoveryTokens()
      .then(setTokens)
      .catch(() => {});
    api
      .listUsers()
      .then(setUsers)
      .catch(() => {});

    // Refresh tokens periodically and on window focus
    const interval = setInterval(loadTokens, 30_000);
    const onFocus = () => loadTokens();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadTokens, setUsers]);

  const handleCreate = async () => {
    if (selectedUserId.length === 0) return;
    setLoading(true);
    try {
      await api.createRecoveryToken(selectedUserId[0]);
      await loadTokens();
      setSelectedUserId([]);
    } catch (e) {
      console.error('Recovery token operation failed:', e);
    }
    setLoading(false);
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeRecoveryToken(id);
      await loadTokens();
    } catch (e) {
      console.error('Failed to revoke token:', e);
    }
  };

  return (
    <div>
      <div className='mb-4'>
        <UserPicker
          mode='single'
          selected={selectedUserId}
          onChange={setSelectedUserId}
          label='Select user'
          placeholder='Search users...'
        />
        <Button
          color='primary'
          size='sm'
          isLoading={loading}
          isDisabled={selectedUserId.length === 0}
          onPress={handleCreate}
          className='mt-2'
        >
          Generate
        </Button>
      </div>

      <div className='space-y-2'>
        {tokens.map((t) => (
          <Card key={t.id} className={t.used ? 'opacity-50' : ''}>
            <CardBody className='flex-row items-center justify-between py-3'>
              <div>
                <p className='text-sm text-default-700'>
                  For <span className='font-medium'>{t.for_user}</span>
                </p>
                <code className='text-xs text-success font-mono'>
                  {t.token.substring(0, 16)}...
                </code>
                <p className='text-xs text-default-500 mt-1'>
                  {t.used
                    ? `Used${t.used_at ? `: ${new Date(t.used_at).toLocaleString()}` : ''}`
                    : `Expires: ${new Date(t.expires_at).toLocaleString()}`}
                </p>
              </div>
              {!t.used && (
                <div className='flex gap-1'>
                  <Button
                    variant='light'
                    color='primary'
                    size='sm'
                    onPress={() => copyToken(t.token)}
                  >
                    Copy
                  </Button>
                  <Button
                    variant='light'
                    color='danger'
                    size='sm'
                    onPress={() => handleRevoke(t.id)}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        ))}
        {tokens.length === 0 && (
          <p className='text-default-500 text-sm'>
            No recovery tokens generated yet.
          </p>
        )}
      </div>
    </div>
  );
}
