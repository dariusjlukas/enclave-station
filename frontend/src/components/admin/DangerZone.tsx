import { useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import * as api from '../../services/api';

const colorSchemes = {
  danger: {
    stripe: '#eab308',
    coverFrontBg:
      'linear-gradient(180deg, rgba(250,204,21,0.25) 0%, rgba(250,204,21,0.12) 100%)',
    coverFrontBorder: '2px solid rgba(250,204,21,0.4)',
    coverBackBg:
      'linear-gradient(0deg, rgba(250,204,21,0.18) 0%, rgba(250,204,21,0.08) 100%)',
    coverBackBorder: '2px solid rgba(250,204,21,0.3)',
    coverRidgeBorder: '1px solid rgba(250,204,21,0.15)',
    coverRidgeBg:
      'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(250,204,21,0.06) 100%)',
    coverTextClass: 'text-amber-500/80',
    coverBackTextClass: 'text-amber-400/50',
    buttonBorder: 'border-red-900/80',
    buttonActiveGradient:
      'radial-gradient(circle at 35% 35%, #ff4444, #dc2626 40%, #991b1b)',
    buttonInactiveGradient:
      'radial-gradient(circle at 35% 35%, #b91c1c, #991b1b 40%, #7f1d1d)',
    buttonActiveShadow:
      '0 0 16px rgba(239,68,68,0.5), inset 0 -3px 6px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.15)',
    buttonInactiveShadow:
      'inset 0 -3px 6px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.1)',
    buttonTextClass: 'text-red-100/90',
    labelTextClass: 'text-amber-400/90',
  },
  safe: {
    stripe: '#22c55e',
    coverFrontBg:
      'linear-gradient(180deg, rgba(34,197,94,0.25) 0%, rgba(34,197,94,0.12) 100%)',
    coverFrontBorder: '2px solid rgba(34,197,94,0.4)',
    coverBackBg:
      'linear-gradient(0deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.08) 100%)',
    coverBackBorder: '2px solid rgba(34,197,94,0.3)',
    coverRidgeBorder: '1px solid rgba(34,197,94,0.15)',
    coverRidgeBg:
      'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(34,197,94,0.06) 100%)',
    coverTextClass: 'text-green-500/80',
    coverBackTextClass: 'text-green-400/50',
    buttonBorder: 'border-green-900/80',
    buttonActiveGradient:
      'radial-gradient(circle at 35% 35%, #4ade80, #22c55e 40%, #166534)',
    buttonInactiveGradient:
      'radial-gradient(circle at 35% 35%, #166534, #14532d 40%, #052e16)',
    buttonActiveShadow:
      '0 0 16px rgba(34,197,94,0.5), inset 0 -3px 6px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.15)',
    buttonInactiveShadow:
      'inset 0 -3px 6px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.1)',
    buttonTextClass: 'text-green-100/90',
    labelTextClass: 'text-green-400/90',
  },
} as const;

function EmergencyButton({
  coverOpen,
  setCoverOpen,
  onPress,
  buttonLabel,
  plateLabel,
  plateLabelOpen,
  variant = 'danger',
}: {
  coverOpen: boolean;
  setCoverOpen: (open: boolean) => void;
  onPress: () => void;
  buttonLabel: string;
  plateLabel: string;
  plateLabelOpen: string;
  variant?: 'danger' | 'safe';
}) {
  const c = colorSchemes[variant];

  return (
    <div className='flex justify-center pt-40'>
      <div className='relative w-[136px]'>
        {/* Transparent hinged cover — swings outward and up */}
        <div
          className='absolute inset-0 z-10 cursor-pointer'
          style={{
            transformOrigin: 'top center',
            transform: coverOpen
              ? 'perspective(600px) rotateX(110deg)'
              : 'perspective(600px) rotateX(0deg)',
            transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            transformStyle: 'preserve-3d',
          }}
          onClick={() => setCoverOpen(!coverOpen)}
        >
          {/* Front face (outside of cover — visible when closed) */}
          <div
            className='absolute inset-0 rounded-xl
              flex items-end justify-center pb-3
              hover:brightness-110 transition-[filter]'
            style={{
              background: c.coverFrontBg,
              border: c.coverFrontBorder,
              boxShadow:
                '0 4px 12px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.2)',
              backdropFilter: 'blur(1px)',
              backfaceVisibility: 'hidden',
            }}
          >
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${c.coverTextClass} select-none`}
            >
              Lift cover to arm
            </span>
          </div>
          {/* Back face (underside of cover — visible when open) */}
          <div
            className='absolute inset-0 rounded-xl'
            style={{
              background: c.coverBackBg,
              border: c.coverBackBorder,
              boxShadow:
                'inset 0 2px 8px rgba(0,0,0,0.2), inset 0 -1px 1px rgba(255,255,255,0.1)',
              backfaceVisibility: 'hidden',
              transform: 'rotateX(180deg)',
            }}
          >
            {/* Inner ridges / texture of the plastic underside */}
            <div
              className='absolute inset-2 rounded-lg'
              style={{
                border: c.coverRidgeBorder,
                background: c.coverRidgeBg,
              }}
            />
            <div className='absolute inset-0 flex items-start justify-center pt-2.5'>
              <span
                className={`text-[9px] font-semibold uppercase tracking-wider ${c.coverBackTextClass} select-none`}
              >
                Click to close
              </span>
            </div>
          </div>
        </div>

        {/* Hazard base plate */}
        <div
          className='rounded-xl p-3 pb-4'
          style={{
            background: `repeating-linear-gradient(-45deg, ${c.stripe}, ${c.stripe} 8px, #1a1a1a 8px, #1a1a1a 16px)`,
          }}
        >
          {/* Inner dark housing */}
          <div className='bg-neutral-800 rounded-lg p-3 flex flex-col items-center gap-2'>
            {/* The button */}
            <button
              disabled={!coverOpen}
              onClick={onPress}
              className={`w-20 h-20 rounded-full border-4 ${c.buttonBorder} cursor-pointer
                transition-all duration-150 disabled:cursor-not-allowed
                flex items-center justify-center`}
              style={{
                background: coverOpen
                  ? c.buttonActiveGradient
                  : c.buttonInactiveGradient,
                boxShadow: coverOpen
                  ? c.buttonActiveShadow
                  : c.buttonInactiveShadow,
              }}
            >
              <span
                className={`text-base font-bold tracking-wider ${c.buttonTextClass} text-center leading-tight select-none`}
              >
                {buttonLabel}
              </span>
            </button>

            {/* Label plate */}
            <div className='bg-neutral-700 rounded px-3 py-0.5'>
              <span
                className={`text-[9px] font-mono uppercase tracking-widest ${c.labelTextClass} select-none`}
              >
                {coverOpen ? plateLabelOpen : plateLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DangerZone() {
  const [archiveCoverOpen, setArchiveCoverOpen] = useState(false);
  const [lockdownCoverOpen, setLockdownCoverOpen] = useState(false);
  const [liftLockdownCoverOpen, setLiftLockdownCoverOpen] = useState(false);
  const [liftArchiveCoverOpen, setLiftArchiveCoverOpen] = useState(false);
  const serverArchived = useChatStore((s) => s.serverArchived);
  const setServerArchived = useChatStore((s) => s.setServerArchived);
  const serverLockedDown = useChatStore((s) => s.serverLockedDown);
  const setServerLockedDown = useChatStore((s) => s.setServerLockedDown);

  return (
    <div className='space-y-10'>
      {/* Lockdown Mode */}
      <div>
        <p className='text-sm font-medium text-foreground mb-1'>
          {serverLockedDown ? 'Server Locked Down' : 'Lockdown Mode'}
        </p>
        <p className='text-xs text-default-400 mb-3'>
          {serverLockedDown
            ? 'The server is currently in lockdown. Only owners and admins can access it.'
            : 'Lockdown mode will immediately kick all non-admin users and prevent them from logging in until lockdown is lifted.'}
        </p>
        {serverLockedDown ? (
          <EmergencyButton
            coverOpen={liftLockdownCoverOpen}
            setCoverOpen={setLiftLockdownCoverOpen}
            onPress={async () => {
              try {
                await api.unlockServer();
                setServerLockedDown(false);
                setLiftLockdownCoverOpen(false);
              } catch (e) {
                console.error('Unlock failed:', e);
              }
            }}
            buttonLabel='LIFT'
            plateLabel='Locked'
            plateLabelOpen='Cover open'
            variant='safe'
          />
        ) : (
          <EmergencyButton
            coverOpen={lockdownCoverOpen}
            setCoverOpen={setLockdownCoverOpen}
            onPress={async () => {
              if (
                !confirm(
                  'Are you sure you want to lock down the server? All non-admin users will be immediately kicked.',
                )
              )
                return;
              try {
                await api.lockdownServer();
                setServerLockedDown(true);
                setLockdownCoverOpen(false);
              } catch (e) {
                console.error('Lockdown failed:', e);
              }
            }}
            buttonLabel='БЛОК'
            plateLabel='Lockdown'
            plateLabelOpen='Cover open'
          />
        )}
      </div>

      {/* Divider */}
      <div className='border-t border-default-200' />

      {/* Archive Server */}
      <div>
        <p className='text-sm font-medium text-foreground mb-1'>
          {serverArchived ? 'Server Archived' : 'Archive Server'}
        </p>
        <p className='text-xs text-default-400 mb-3'>
          {serverArchived
            ? 'The server is currently archived. Users cannot send messages or create channels.'
            : 'Archiving the server will prevent all users from sending messages or creating channels.'}
        </p>
        {serverArchived ? (
          <EmergencyButton
            coverOpen={liftArchiveCoverOpen}
            setCoverOpen={setLiftArchiveCoverOpen}
            onPress={async () => {
              try {
                await api.unarchiveServer();
                setServerArchived(false);
                setLiftArchiveCoverOpen(false);
              } catch (e) {
                console.error('Unarchive failed:', e);
              }
            }}
            buttonLabel='LIFT'
            plateLabel='Archived'
            plateLabelOpen='Cover open'
            variant='safe'
          />
        ) : (
          <EmergencyButton
            coverOpen={archiveCoverOpen}
            setCoverOpen={setArchiveCoverOpen}
            onPress={async () => {
              if (
                !confirm(
                  'Are you sure you want to archive the server? All messaging will be disabled.',
                )
              )
                return;
              try {
                await api.archiveServer();
                setServerArchived(true);
                setArchiveCoverOpen(false);
              } catch (e) {
                console.error('Archive failed:', e);
              }
            }}
            buttonLabel='АЗ-5'
            plateLabel='Emergency'
            plateLabelOpen='Cover open'
          />
        )}
      </div>
    </div>
  );
}
