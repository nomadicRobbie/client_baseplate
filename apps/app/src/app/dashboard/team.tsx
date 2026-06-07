import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Redirect } from 'expo-router';
import type { TeamUser } from '@blnk/shared';
import { useProfile } from '@/lib/profile-context';
import { getAccessToken } from '@/lib/session';
import { listTeam, addTeamUser, setTeamUserActive } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Badge, Notice } from '@/ui/components';

type Msg = { text: string; tone: 'success' | 'error' };
const ROLES: ('member' | 'admin')[] = ['member', 'admin'];

export default function Team() {
  const t = useTheme();
  const { data } = useProfile();
  const meRole = data?.me.role;
  const meId = data?.me.userId;
  const isSuper = meRole === 'super';
  const isAdmin = meRole === 'admin' || isSuper;

  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const load = async () => {
    setLoading(true);
    try { setUsers((await listTeam(getAccessToken()!)).users); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  const add = async () => {
    if (!email.trim()) { setMsg({ text: 'Email is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      await addTeamUser(getAccessToken()!, { email: email.trim(), role });
      setEmail(''); setRole('member');
      setMsg({ text: `Added ${email.trim()} — they can sign in with their email.`, tone: 'success' });
      await load();
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setBusy(false); }
  };

  const toggleActive = async (u: TeamUser) => {
    try { await setTeamUserActive(getAccessToken()!, u.id, !u.active); await load(); }
    catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
  };

  return (
    <Screen>
      <Text variant="title">Team</Text>

      {/* Add user — only super may assign admin; the picker reflects that */}
      <Card>
        <Text variant="heading">Add a user</Text>
        <TextField label="Email" value={email} onChangeText={setEmail} placeholder="person@example.com" keyboardType="email-address" autoCapitalize="none" />
        <View style={{ gap: 6 }}>
          <Text variant="label" muted>Role</Text>
          <View style={{ flexDirection: 'row', gap: t.space.sm }}>
            {ROLES.map((r) => {
              const disabled = r === 'admin' && !isSuper;
              const sel = role === r;
              return (
                <Pressable key={r} onPress={() => !disabled && setRole(r)} accessibilityRole="button" disabled={disabled}
                  style={{ opacity: disabled ? 0.4 : 1, paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }}>
                  <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
          {!isSuper && <Text variant="small" muted>Only super users can add admins.</Text>}
        </View>
        <Button label="Add user" onPress={add} loading={busy} />
      </Card>

      {/* Roster */}
      <Card>
        <Text variant="heading">Users {users.length ? `(${users.length})` : ''}</Text>
        {loading ? <Text muted>Loading…</Text> : users.map((u) => (
          <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text>{u.name ?? u.email}</Text>
              <Text variant="small" muted>{u.email}</Text>
            </View>
            <Badge label={u.role} tone={u.role === 'super' ? 'accent' : 'neutral'} />
            {!u.active && <Badge label="disabled" tone="neutral" />}
            {u.id !== meId && u.role !== 'super' && (
              <Pressable onPress={() => toggleActive(u)} accessibilityRole="button">
                <Text variant="small" color={u.active ? t.color.accent : t.color.success}>{u.active ? 'Disable' : 'Enable'}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </Card>

      {msg && <Notice message={msg.text} tone={msg.tone} />}
    </Screen>
  );
}
