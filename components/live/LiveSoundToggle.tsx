/**
 * LiveSoundToggle (owner W6-live) — header icon button next to the
 * NotificationBell.
 *
 *   icon      volume-up (sound on and armed) / volume-down + small dot (on, but
 *             the browser still needs one click before it may play) /
 *             volume-off (muted)
 *   dot       live connection: green live, amber connecting/polling, grey offline
 *   click     muted -> unmute + test chime; on but not armed -> arm + test chime;
 *             on and armed -> mute
 */
import React, { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, IconButton, Tooltip } from '@mui/material';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import VolumeDownRoundedIcon from '@mui/icons-material/VolumeDownRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import {
  armOrderSound,
  isOrderSoundMuted,
  isSoundArmed,
  playOrderSound,
  setOrderSoundMuted,
  subscribeOrderSound,
} from './orderSound';
import { useLiveStatus } from './useLiveEvent';

type SoundState = 'muted' | 'armed' | 'needsGesture';

function readSoundState(): SoundState {
  if (isOrderSoundMuted()) return 'muted';
  return isSoundArmed() ? 'armed' : 'needsGesture';
}

export type LiveSoundToggleProps = {
  size?: 'small' | 'medium';
  /** extra sx for the IconButton (match neighbouring header buttons) */
  sx?: React.ComponentProps<typeof IconButton>['sx'];
};

export default function LiveSoundToggle({ size = 'medium', sx }: LiveSoundToggleProps) {
  const t = useTranslations('liveOrders');
  const sound = useSyncExternalStore(subscribeOrderSound, readSoundState, () => 'needsGesture' as SoundState);
  const { status } = useLiveStatus();

  useEffect(() => {
    armOrderSound();
  }, []);

  const onClick = useCallback(() => {
    const current = readSoundState();
    if (current === 'muted') {
      setOrderSoundMuted(false);
      playOrderSound('test');
    } else if (current === 'needsGesture') {
      playOrderSound('test'); // this click is the gesture that unlocks audio
    } else {
      setOrderSoundMuted(true);
    }
  }, []);

  const soundLabel =
    sound === 'muted' ? t('sound.muted') : sound === 'armed' ? t('sound.on') : t('sound.needsClick');
  const actionLabel = sound === 'armed' ? t('sound.clickToMute') : t('sound.clickToEnable');
  const statusLabel =
    status === 'live'
      ? t('status.live')
      : status === 'polling'
        ? t('status.polling')
        : status === 'offline'
          ? t('status.offline')
          : status === 'connecting'
            ? t('status.connecting')
            : '';

  const dotColor =
    status === 'live' ? 'success.main' : status === 'offline' ? 'grey.500' : status === 'idle' ? 'transparent' : 'warning.main';

  const Icon = sound === 'muted' ? VolumeOffRoundedIcon : sound === 'armed' ? VolumeUpRoundedIcon : VolumeDownRoundedIcon;

  return (
    <Tooltip
      title={
        <span style={{ whiteSpace: 'pre-line' }}>
          {[soundLabel, actionLabel, statusLabel].filter(Boolean).join('\n')}
        </span>
      }
      arrow
    >
      <IconButton
        size={size}
        onClick={onClick}
        aria-label={`${soundLabel}. ${actionLabel}`}
        aria-pressed={sound !== 'muted'}
        sx={[{ minWidth: 40, minHeight: 40 }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      >
        <Badge
          variant="dot"
          overlap="circular"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          invisible={status === 'idle'}
          sx={{
            '& .MuiBadge-badge': {
              bgcolor: dotColor,
              boxShadow: (theme) => `0 0 0 2px ${theme.palette.background.paper}`,
            },
          }}
        >
          <Badge
            variant="dot"
            overlap="circular"
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            invisible={sound !== 'needsGesture'}
            sx={{ '& .MuiBadge-badge': { bgcolor: 'primary.main', minWidth: 6, width: 6, height: 6 } }}
          >
            <Icon
              fontSize={size === 'small' ? 'small' : 'medium'}
              sx={{ color: sound === 'muted' ? 'text.disabled' : 'text.secondary' }}
            />
          </Badge>
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
