import { useState, useEffect, useCallback } from 'react';
import { Button } from '@heroui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTerminal,
  faPlay,
  faStop,
  faRotateRight,
  faFileImport,
  faFileExport,
  faCode,
} from '@fortawesome/free-solid-svg-icons';
import { useSandboxStore } from '../../stores/sandboxStore';
import { v86Manager } from '../../services/v86Manager';
import { SandboxIDE } from './SandboxIDE';
import { SandboxTerminal } from './SandboxTerminal';
import { SandboxImportModal } from './SandboxImportModal';
import { SandboxExportModal } from './SandboxExportModal';

export function SandboxView() {
  const vmState = useSandboxStore((s) => s.vmState);
  const setVmState = useSandboxStore((s) => s.setVmState);
  const ideVisible = useSandboxStore((s) => s.ideVisible);
  const setIdeVisible = useSandboxStore((s) => s.setIdeVisible);
  const clearIdeState = useSandboxStore((s) => s.clearIdeState);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    v86Manager.setStateChangeCallback((state) => {
      setVmState(state);
      if (state === 'none' || state === 'booting') {
        clearIdeState();
      }
    });
    setVmState(v86Manager.getState());
  }, [setVmState, clearIdeState]);

  const handleStart = useCallback(async () => {
    try {
      await v86Manager.start();
    } catch (err) {
      console.error('Failed to start sandbox:', err);
      setVmState('none');
    }
  }, [setVmState]);

  const handleStop = useCallback(() => {
    v86Manager.stop();
  }, []);

  const handleRestart = useCallback(async () => {
    try {
      await v86Manager.restart();
    } catch (err) {
      console.error('Failed to restart sandbox:', err);
    }
  }, []);

  const handleStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    if (msg) setTimeout(() => setStatusMsg(''), 3000);
  }, []);

  return (
    <div className='flex-1 flex flex-col h-full overflow-hidden'>
      {/* Header */}
      <div className='border-b border-default-200 px-4 py-3 flex items-center gap-2 flex-shrink-0'>
        <FontAwesomeIcon icon={faTerminal} className='text-default-500' />
        <h2 className='text-sm font-semibold text-foreground'>Sandbox</h2>

        {statusMsg && (
          <span className='text-xs text-default-400 ml-2 truncate max-w-60'>
            {statusMsg}
          </span>
        )}

        <div className='flex-1' />

        {vmState === 'running' && (
          <>
            <Button
              size='sm'
              variant={ideVisible ? 'solid' : 'flat'}
              color={ideVisible ? 'primary' : 'default'}
              onPress={() => setIdeVisible(!ideVisible)}
              startContent={<FontAwesomeIcon icon={faCode} />}
              className='mr-1'
            >
              IDE
            </Button>
            <Button
              size='sm'
              variant='flat'
              onPress={() => setShowImportModal(true)}
              startContent={<FontAwesomeIcon icon={faFileImport} />}
              className='mr-1'
            >
              Import
            </Button>
            <Button
              size='sm'
              variant='flat'
              onPress={() => setShowExportModal(true)}
              startContent={<FontAwesomeIcon icon={faFileExport} />}
              className='mr-2'
            >
              Export
            </Button>
            <Button
              size='sm'
              variant='flat'
              color='warning'
              onPress={handleRestart}
              startContent={<FontAwesomeIcon icon={faRotateRight} />}
            >
              Restart
            </Button>
            <Button
              size='sm'
              variant='flat'
              color='danger'
              onPress={handleStop}
              startContent={<FontAwesomeIcon icon={faStop} />}
            >
              Stop
            </Button>
          </>
        )}
        {vmState === 'booting' && (
          <Button
            size='sm'
            variant='flat'
            color='danger'
            onPress={handleStop}
            startContent={<FontAwesomeIcon icon={faStop} />}
          >
            Cancel
          </Button>
        )}
        {(vmState === 'none' || vmState === 'stopped') && (
          <Button
            size='sm'
            variant='flat'
            color='success'
            onPress={handleStart}
            startContent={<FontAwesomeIcon icon={faPlay} />}
          >
            Start
          </Button>
        )}
      </div>

      {/* Content */}
      <div className='flex-1 overflow-hidden bg-[#1a1a2e]'>
        {vmState === 'running' && <SandboxIDE />}

        {vmState === 'booting' && (
          <div className='h-full bg-[#1a1a2e]'>
            <SandboxTerminal />
          </div>
        )}

        {(vmState === 'none' || vmState === 'stopped') && (
          <div className='flex flex-col items-center justify-center h-full gap-6'>
            <div className='flex flex-col items-center gap-2'>
              <FontAwesomeIcon
                icon={faTerminal}
                className='text-4xl text-default-300'
              />
              <p className='text-default-400 text-sm text-center max-w-md'>
                Start a lightweight Linux environment in your browser. Use it to
                quickly test code, run scripts, or explore command-line tools in
                an isolated sandbox.
              </p>
            </div>
            <Button
              size='lg'
              color='primary'
              variant='flat'
              onPress={handleStart}
              startContent={<FontAwesomeIcon icon={faPlay} />}
            >
              Start Sandbox
            </Button>
          </div>
        )}
      </div>

      <SandboxImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onStatus={handleStatus}
      />
      <SandboxExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}
