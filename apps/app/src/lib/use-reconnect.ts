import { useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';

// Calls `onReconnect` on the offline → online edge (not on every network event, and
// not on the initial state). Used to auto-flush the offline outbox the moment a
// roaming mobile regains coverage. Cross-platform — NetInfo supports web too.
//
// `isConnected` is the trigger: if there's a network but no real internet, a flush
// simply fails and the outbox keeps the commands (flush is safe to retry), so we
// don't need the slower/nullable isInternetReachable to gate it.
export function useOnReconnect(onReconnect: () => void): void {
  const wasConnected = useRef(true);
  const cb = useRef(onReconnect);
  cb.current = onReconnect;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true;
      if (connected && !wasConnected.current) cb.current();
      wasConnected.current = connected;
    });
    return unsubscribe;
  }, []);
}
