import { useEffect, useRef, useState } from 'react';
import {
  connectGameToHost,
  observeGameContentSize,
  type GuestBridgeConnection,
  type HostApiV1,
  type HostSnapshotV1,
} from '@chain/casino-sdk/guest';

type SnapshotListener = (snapshot: HostSnapshotV1 | null) => void;

type HostBridge = {
  connection: GuestBridgeConnection;
  listeners: Set<SnapshotListener>;
  latest: HostSnapshotV1 | null;
};

let bridge: HostBridge | undefined;

/**
 * One connection per page. The host binds its guest proxy to the first
 * handshake, so connecting again on a remount (StrictMode in dev) would leave
 * the host pushing into a destroyed connection.
 */
function hostBridge(): HostBridge {
  if (bridge) return bridge;
  const listeners = new Set<SnapshotListener>();
  const created: HostBridge = {
    listeners,
    latest: null,
    connection: connectGameToHost({
      async setState(snapshot) {
        created.latest = snapshot;
        listeners.forEach(listener => listener(snapshot));
      },
    }),
  };
  bridge = created;
  return created;
}

export type HostMode = 'connecting' | 'hosted' | 'standalone';

/**
 * Guest side of the casino bridge.
 *
 * `mode` starts as 'connecting'. If the handshake has not resolved within
 * `handshakeTimeoutMs` the page is being opened directly (the jam requires a
 * standalone playable demo), so the app switches to demo mode: same paytable,
 * same animation, a local play-money balance and clearly labelled demo RNG.
 */
export function useCasinoHost(handshakeTimeoutMs = 1800): {
  hostApi: HostApiV1 | null;
  snapshot: HostSnapshotV1 | null;
  mode: HostMode;
} {
  const [hostApi, setHostApi] = useState<HostApiV1 | null>(null);
  const [snapshot, setSnapshot] = useState<HostSnapshotV1 | null>(null);
  const [mode, setMode] = useState<HostMode>('connecting');
  const settled = useRef(false);

  useEffect(() => {
    const { connection, listeners, latest } = hostBridge();
    let mounted = true;
    listeners.add(setSnapshot);
    setSnapshot(latest);

    void connection.promise
      .then(parent => {
        if (!mounted) return;
        settled.current = true;
        setHostApi(parent);
        setMode('hosted');
      })
      .catch(() => {
        if (mounted) setMode('standalone');
      });

    const timer = setTimeout(() => {
      if (mounted && !settled.current) setMode('standalone');
    }, handshakeTimeoutMs);

    return () => {
      mounted = false;
      clearTimeout(timer);
      listeners.delete(setSnapshot);
    };
  }, [handshakeTimeoutMs]);

  useEffect(() => {
    if (!hostApi) return;
    const observer = observeGameContentSize(hostApi);
    return () => observer.disconnect();
  }, [hostApi]);

  return { hostApi, snapshot, mode };
}
