import { useState, useEffect } from 'react';
import { Button, Card, CardBody, Alert, Spinner, Divider } from '@heroui/react';
import QRCode from 'qrcode';
import * as api from '../../services/api';

interface Device {
  id: string;
  device_name: string;
  created_at: string;
}

export function DeviceManager() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [deviceToken, setDeviceToken] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  useEffect(() => {
    loadDevices();
    api.getPublicConfig().then((config) => {
      setPublicUrl(config.public_url);
    });
  }, []);

  const loadDevices = async () => {
    try {
      const data = await api.listDevices();
      setDevices(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setError('');
    setGenerating(true);
    setCopied(false);
    try {
      const result = await api.createDeviceToken();
      setDeviceToken(result.token);

      const baseUrl = publicUrl || window.location.origin;
      const linkUrl = `${baseUrl}?device_token=${result.token}`;

      const dataUrl = await QRCode.toDataURL(linkUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate token');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(deviceToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemoveDevice = async (id: string) => {
    if (!confirm('Remove this device? It will no longer be able to sign in.'))
      return;
    setError('');
    try {
      await api.removeDevice(id);
      setDevices(devices.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove device');
    }
  };

  if (loading)
    return (
      <div className='flex justify-center py-4'>
        <Spinner size='sm' />
      </div>
    );

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-semibold text-foreground'>Linked Devices</h3>

      <p className='text-sm text-default-500'>
        Link additional devices to your account so you can sign in from multiple
        browsers or phones.
      </p>

      {error && (
        <Alert color='danger' variant='flat'>
          {error}
        </Alert>
      )}

      <div className='space-y-2'>
        {devices.map((device) => (
          <Card key={device.id}>
            <CardBody className='flex-row items-center justify-between py-2'>
              <div>
                <div className='text-sm text-foreground'>
                  {device.device_name}
                </div>
                <div className='text-xs text-default-500'>
                  Added {new Date(device.created_at).toLocaleDateString()}
                </div>
              </div>
              {devices.length > 1 && (
                <Button
                  color='danger'
                  variant='light'
                  size='sm'
                  onPress={() => handleRemoveDevice(device.id)}
                >
                  Remove
                </Button>
              )}
            </CardBody>
          </Card>
        ))}
        {devices.length === 0 && (
          <p className='text-sm text-default-400'>
            No legacy device keys linked. Your passkeys and browser keys are
            listed in their own sections.
          </p>
        )}
      </div>

      <Divider />

      <h3 className='text-lg font-semibold text-foreground'>Link New Device</h3>

      {!deviceToken ? (
        <Button
          color='primary'
          fullWidth
          onPress={handleGenerate}
          isLoading={generating}
        >
          Generate Device Link
        </Button>
      ) : (
        <Card>
          <CardBody className='space-y-4'>
            <p className='text-sm text-default-500'>
              On the new device, open the app and choose &quot;Link existing
              account&quot;, then enter this token or scan the QR code. This
              token expires in 15 minutes.
            </p>

            {qrDataUrl && (
              <div className='flex justify-center py-2'>
                <img
                  src={qrDataUrl}
                  alt='Device link QR code'
                  className='rounded-lg'
                  width={200}
                  height={200}
                />
              </div>
            )}

            <div className='flex items-center gap-2'>
              <code className='flex-1 text-xs bg-default-100 px-3 py-2 rounded font-mono select-all break-all'>
                {deviceToken}
              </code>
              <Button
                size='sm'
                variant='flat'
                color={copied ? 'success' : 'primary'}
                onPress={handleCopy}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>

            <Button
              variant='light'
              color='default'
              size='sm'
              fullWidth
              onPress={() => {
                setDeviceToken('');
                setQrDataUrl('');
              }}
            >
              Done
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
