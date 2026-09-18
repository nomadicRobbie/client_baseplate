import { useState } from 'react';
import { View } from 'react-native';
import { Screen, Pill } from '@/ui/components';
import { useTheme } from '@/theme';
import { makeStyles, type Tab, type ToastMsg } from './_shared';
import { EventsTab } from './_events';
import { BannerTab } from './_banners';
import { AnnouncementTab } from './_announcements';
import { InfoTab } from './_info';

export default function Website() {
  const t = useTheme();
  const s = makeStyles(t);
  const [tab, setTab] = useState<Tab>('events');
  const [msg, setMsg] = useState<ToastMsg | null>(null);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'events',        label: 'Events' },
    { key: 'banners',       label: 'Banners' },
    { key: 'announcements', label: 'Announcements' },
    { key: 'info',          label: 'Info' },
  ];

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <View style={s.tabRow}>
        {TABS.map(({ key, label }) => (
          <Pill key={key} label={label} active={tab === key} onPress={() => setTab(key)} size="sm" />
        ))}
      </View>

      {tab === 'events'        && <EventsTab        setMsg={setMsg} />}
      {tab === 'banners'       && <BannerTab        setMsg={setMsg} />}
      {tab === 'announcements' && <AnnouncementTab  setMsg={setMsg} />}
      {tab === 'info'          && <InfoTab          setMsg={setMsg} />}
    </Screen>
  );
}
