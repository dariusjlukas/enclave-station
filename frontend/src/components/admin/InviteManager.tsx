import { useState, useEffect } from 'react';
import {
  Button,
  Card,
  CardBody,
  Input,
  Select,
  SelectItem,
  RadioGroup,
  Radio,
} from '@heroui/react';
import * as api from '../../services/api';

const EXPIRY_OPTIONS = [
  { key: '1', label: '1 hour' },
  { key: '6', label: '6 hours' },
  { key: '12', label: '12 hours' },
  { key: '24', label: '1 day' },
  { key: '72', label: '3 days' },
  { key: '168', label: '7 days' },
  { key: '336', label: '14 days' },
  { key: '720', label: '30 days' },
];

export function InviteManager() {
  const [invites, setInvites] = useState<api.Invite[]>([]);
  const [loading, setLoading] = useState(false);

  // Creation form state
  const [expiryHours, setExpiryHours] = useState('24');
  const [useType, setUseType] = useState<'single' | 'multi' | 'unlimited'>(
    'single',
  );
  const [maxUsesInput, setMaxUsesInput] = useState('10');

  const loadInvites = async () => {
    try {
      const data = await api.listInvites();
      setInvites(data);
    } catch (e) {
      console.error('Invite operation failed:', e);
    }
  };

  useEffect(() => {
    api
      .listInvites()
      .then(setInvites)
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const expiry = parseInt(expiryHours) || 24;
      let maxUses = 1;
      if (useType === 'unlimited') {
        maxUses = 0;
      } else if (useType === 'multi') {
        maxUses = Math.max(2, parseInt(maxUsesInput) || 10);
      }
      await api.createInvite(expiry, maxUses);
      await loadInvites();
    } catch (e) {
      console.error('Invite operation failed:', e);
    }
    setLoading(false);
  };

  const getInviteLink = (token: string) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}?invite=${token}`;
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(getInviteLink(token));
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeInvite(id);
      await loadInvites();
    } catch (e) {
      console.error('Failed to revoke invite:', e);
    }
  };

  const isFullyUsed = (inv: api.Invite) =>
    inv.max_uses === 1 && inv.use_count >= 1;

  const isExpired = (inv: api.Invite) => new Date(inv.expires_at) < new Date();

  const isActive = (inv: api.Invite) =>
    !isFullyUsed(inv) &&
    !isExpired(inv) &&
    (inv.max_uses === 0 || inv.use_count < inv.max_uses);

  const usageLabel = (inv: api.Invite) => {
    if (inv.max_uses === 0) return `${inv.use_count} uses (unlimited)`;
    if (inv.max_uses === 1) return inv.use_count >= 1 ? 'Used' : 'Single use';
    return `${inv.use_count} / ${inv.max_uses} uses`;
  };

  return (
    <div>
      <Card className='mb-4'>
        <CardBody className='space-y-3'>
          <p className='text-sm font-medium text-default-600'>
            Generate Invite
          </p>

          <div className='flex items-end gap-3'>
            <Select
              label='Expires after'
              size='sm'
              variant='bordered'
              className='max-w-[160px]'
              selectedKeys={[expiryHours]}
              onChange={(e) => setExpiryHours(e.target.value || '24')}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <SelectItem key={o.key}>{o.label}</SelectItem>
              ))}
            </Select>

            {useType === 'multi' && (
              <Input
                label='Max uses'
                size='sm'
                variant='bordered'
                type='number'
                className='max-w-[100px]'
                value={maxUsesInput}
                onChange={(e) => setMaxUsesInput(e.target.value)}
                min={2}
              />
            )}
          </div>

          <RadioGroup
            orientation='horizontal'
            size='sm'
            value={useType}
            onValueChange={(v) =>
              setUseType(v as 'single' | 'multi' | 'unlimited')
            }
          >
            <Radio value='single'>One-time use</Radio>
            <Radio value='multi'>Limited uses</Radio>
            <Radio value='unlimited'>Unlimited uses</Radio>
          </RadioGroup>

          <Button
            color='primary'
            size='sm'
            isLoading={loading}
            onPress={handleCreate}
          >
            Generate Invite
          </Button>
        </CardBody>
      </Card>

      <div className='space-y-2'>
        {invites.map((inv) => {
          const fullyUsed = isFullyUsed(inv);
          const expired = isExpired(inv);
          const active = isActive(inv);

          return (
            <Card
              key={inv.id}
              className={fullyUsed || expired ? 'opacity-50' : ''}
            >
              <CardBody className='py-3'>
                <div className='flex items-center justify-between'>
                  <div className='min-w-0'>
                    <code className='text-sm text-success font-mono'>
                      {inv.token.substring(0, 16)}...
                    </code>
                    <div className='flex flex-wrap gap-x-3 gap-y-0.5 mt-1'>
                      <span className='text-xs text-default-500'>
                        {usageLabel(inv)}
                      </span>
                      <span className='text-xs text-default-400'>
                        {expired
                          ? 'Expired'
                          : `Expires: ${new Date(inv.expires_at).toLocaleString()}`}
                      </span>
                    </div>
                  </div>
                  <div className='flex gap-1 flex-shrink-0'>
                    {active && (
                      <>
                        <Button
                          variant='light'
                          color='primary'
                          size='sm'
                          onPress={() => copyLink(inv.token)}
                        >
                          Copy Link
                        </Button>
                        <Button
                          variant='light'
                          color='default'
                          size='sm'
                          onPress={() => copyToken(inv.token)}
                        >
                          Copy Token
                        </Button>
                      </>
                    )}
                    {!fullyUsed && (
                      <Button
                        variant='light'
                        color='danger'
                        size='sm'
                        onPress={() => handleRevoke(inv.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>

                {inv.uses.length > 0 && (
                  <div className='mt-2 border-t border-default-100 pt-2'>
                    <p className='text-xs text-default-400 mb-1'>
                      Usage history
                    </p>
                    {inv.uses.map((u, i) => (
                      <p key={i} className='text-xs text-default-500'>
                        {u.username} &mdash;{' '}
                        {new Date(u.used_at).toLocaleString()}
                      </p>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
        {invites.length === 0 && (
          <p className='text-default-500 text-sm'>No invites generated yet.</p>
        )}
      </div>
    </div>
  );
}
