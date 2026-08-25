import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Person, TeamUser } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { availableModules } from '@/lib/nav';
import { getAccessToken } from '@/lib/session';
import { listPeople, createPerson, updatePerson, listTeam, addTeamUser, setTeamUserActive, setPersonModule, removePersonModule } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, TextField, Badge } from '@/ui/components';

type Msg = { text: string; tone: 'success' | 'error' };
type ThemeT = ReturnType<typeof useTheme>;
const ROLES: ('member' | 'admin')[] = ['member', 'admin'];

const makeStyles = (t: ThemeT) => ({
  checkbox: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.xs },
  sectionHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  checkboxBox: (checked: boolean) => ({ width: 20, height: 20, borderRadius: t.radius.sm, borderWidth: 1, borderColor: checked ? t.color.primary : t.color.border, backgroundColor: checked ? t.color.primary : 'transparent', alignItems: 'center' as const, justifyContent: 'center' as const }),
  roleSection: { gap: 6 },
  roleRow: { flexDirection: 'row' as const, gap: t.space.sm },
  roleBtn: (sel: boolean, disabled: boolean) => ({ opacity: disabled ? 0.4 : 1, paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  personItem: { paddingVertical: t.space.sm, gap: t.space.sm },
  personHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md },
  personInfo: { flex: 1, gap: 2 },
  moduleRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.xs, alignItems: 'center' as const },
  moduleBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 4, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt },
  moduleAdd: { paddingVertical: 4, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, borderWidth: 1, borderStyle: 'dashed' as const, borderColor: t.color.border },
});

// People — the canonical roster. A person may be "roster only" (no login) or have
// app access (a blnk_auth login, created here and linked via person.user_id). This
// screen replaces the old Team surface: inviting a user is now "give app access".
export default function People() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const t = useTheme();
  const s = makeStyles(t);
  const { features } = useAuth();
  const { data } = useProfile();
  // Operational modules are the ones you assign to members. Admin-only modules
  // (Store, Analytics, Locations) are back-office surfaces gated to admins by the
  // nav itself — assigning them to a member does nothing, so they're not offered.
  const allModules = availableModules(true, features);        // for labels of any assigned module
  const assignableModules = allModules.filter((m) => !m.adminOnly);
  const moduleLabel = (key: string) => allModules.find((m) => m.feature === key)?.label ?? key;
  const meRole = data?.me.role;
  const meId = data?.me.userId;
  const isSuper = meRole === 'super';
  const isAdmin = meRole === 'admin' || isSuper;

  const [people, setPeople] = useState<Person[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]); // all logins in the tenant
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [giveAccess, setGiveAccess] = useState(false);
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const token = getAccessToken()!;
      const [p, tm] = await Promise.all([listPeople(token), listTeam(token)]);
      setPeople(p.people);
      setTeamUsers(tm.users);
    } catch (e) { setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (!isAdmin) return <Redirect href="/dashboard" />;

  const err = (e: unknown) => setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });

  // Resolve a login id for an email: reuse an existing tenant login if one exists
  // (e.g. a self-provisioned account), otherwise create one. Avoids a 409 from
  // trying to create a login that already exists.
  const ensureLogin = async (token: string, email: string, role: 'member' | 'admin'): Promise<string> => {
    const existing = teamUsers.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing) return existing.id;
    const { user } = await addTeamUser(token, { email, role });
    return user.id;
  };

  const add = async () => {
    if (!name.trim()) { setMsg({ text: 'Name is required.', tone: 'error' }); return; }
    if (giveAccess && !email.trim()) { setMsg({ text: 'App access needs an email.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const token = getAccessToken()!;
      let user_id: string | undefined;
      if (giveAccess) {
        user_id = await ensureLogin(token, email.trim(), role);
      }
      await createPerson(token, {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        user_id,
      });
      setName(''); setEmail(''); setPhone(''); setGiveAccess(false); setRole('member');
      setMsg({ text: giveAccess ? `Added ${name.trim()} — they can sign in with their email.` : `Added ${name.trim()} to the roster.`, tone: 'success' });
      await load();
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  // Give an existing roster person a login and link it.
  const giveAppAccess = async (p: Person) => {
    if (!p.email) { setMsg({ text: `${p.name} needs an email before they can get app access.`, tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const token = getAccessToken()!;
      const user_id = await ensureLogin(token, p.email, 'member');
      await updatePerson(token, p.id, { user_id });
      setMsg({ text: `${p.name} can now sign in.`, tone: 'success' });
      await load();
    } catch (e) { err(e); } finally { setBusy(false); }
  };

  const toggleLogin = async (userId: string, active: boolean) => {
    try { await setTeamUserActive(getAccessToken()!, userId, active); await load(); }
    catch (e) { err(e); }
  };

  // Module membership = access. Assign defaults to the 'user' role; role refinement
  // (e.g. asset manager) lands when a module actually consumes person_module.role.
  const assign = async (p: Person, moduleKey: string) => {
    try { await setPersonModule(getAccessToken()!, p.id, moduleKey, 'user'); await load(); }
    catch (e) { err(e); }
  };
  const unassign = async (p: Person, moduleKey: string) => {
    try { await removePersonModule(getAccessToken()!, p.id, moduleKey); await load(); }
    catch (e) { err(e); }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      {!wide && (
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: -4 }}>
          <Ionicons name="chevron-back" size={20} color={t.color.textMuted} />
          <Text variant="label" muted>Account</Text>
        </Pressable>
      )}
      <Text variant="title">People</Text>

      {/* Add a person — roster only, or with app access (creates a login) */}
      <Card>
        <Text variant="heading">Add a person</Text>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="sentences" />
        <TextField label="Email" value={email} onChangeText={setEmail} placeholder="Optional (required for app access)" keyboardType="email-address" autoCapitalize="none" />
        <TextField label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" />

        <Pressable onPress={() => setGiveAccess((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: giveAccess }}
          style={s.checkbox}>
          <View style={s.checkboxBox(giveAccess)}>
            {giveAccess && <Text variant="small" color={t.color.primaryText}>✓</Text>}
          </View>
          <Text variant="label">Give app access (creates a sign-in)</Text>
        </Pressable>

        {giveAccess && (
          <View style={s.roleSection}>
            <Text variant="label" muted>Role</Text>
            <View style={s.roleRow}>
              {ROLES.map((r) => {
                const disabled = r === 'admin' && !isSuper;
                const sel = role === r;
                return (
                  <Pressable key={r} onPress={() => !disabled && setRole(r)} accessibilityRole="button" disabled={disabled}
                    style={s.roleBtn(sel, disabled)}>
                    <Text variant="label" color={sel ? t.color.primaryText : t.color.text}>{r}</Text>
                  </Pressable>
                );
              })}
            </View>
            {!isSuper && <Text variant="small" muted>Only super users can add admins.</Text>}
          </View>
        )}
        <Button label="Add person" onPress={add} loading={busy} />
      </Card>

      {/* Roster */}
      <Card>
        <View style={s.sectionHeader}>
          <Text variant="heading">Roster</Text>
          {people.length > 0 && <Text variant="small" muted>{people.length}</Text>}
        </View>
        {loading ? <Text muted>Loading…</Text> : people.length === 0 ? <Text muted>No people yet.</Text> : people.map((p) => {
          const login = p.user_id ? teamUsers.find((u) => u.id === p.user_id) : undefined;
          const isSelf = !!p.user_id && p.user_id === meId;
          const unassigned = assignableModules.filter((em) => !p.modules.some((m) => m.module === em.feature));
          return (
            <View key={p.id} style={s.personItem}>
              <View style={s.personHeader}>
                <View style={s.personInfo}>
                  <Text>{p.name}</Text>
                  {!!(p.email || p.phone) && <Text variant="small" muted>{[p.email, p.phone].filter(Boolean).join(' · ')}</Text>}
                </View>

                {/* App-access state + controls */}
                {p.user_id ? (
                  <>
                    <Badge label={login?.role ?? 'app access'} tone={login?.role === 'super' ? 'accent' : 'neutral'} />
                    {login && !login.active && <Badge label="disabled" tone="neutral" />}
                    {login && !isSelf && login.role !== 'super' && (
                      <Pressable onPress={() => toggleLogin(p.user_id!, !login.active)} accessibilityRole="button">
                        <Text variant="small" color={login.active ? t.color.accent : t.color.success}>{login.active ? 'Disable' : 'Enable'}</Text>
                      </Pressable>
                    )}
                  </>
                ) : (
                  <Pressable onPress={() => giveAppAccess(p)} accessibilityRole="button" disabled={busy}>
                    <Text variant="small" color={t.color.primary}>Give app access</Text>
                  </Pressable>
                )}
              </View>

              {/* Module access belongs with app access: only people who can sign in
                  get the editor. Admins bypass module gating (full access), so chips
                  are noise for them. A login-less person is just a roster name — if they
                  carry stray assignments, nudge to give them a login to activate them. */}
              {p.user_id && (login?.role === 'admin' || login?.role === 'super') ? (
                <Text variant="small" muted>Full access — admins see every module.</Text>
              ) : p.user_id ? (
                <View style={s.moduleRow}>
                  {p.modules.map((m) => (
                    <Pressable key={m.module} onPress={() => unassign(p, m.module)} accessibilityRole="button" accessibilityLabel={`Remove ${moduleLabel(m.module)}`}
                      style={s.moduleBadge}>
                      <Text variant="small">{moduleLabel(m.module)}</Text>
                      <Text variant="small" muted>✕</Text>
                    </Pressable>
                  ))}
                  {unassigned.map((em) => (
                    <Pressable key={em.feature} onPress={() => assign(p, em.feature as string)} accessibilityRole="button" accessibilityLabel={`Assign ${em.label}`}
                      style={[s.moduleAdd, { borderColor: t.color.border }]}>
                      <Text variant="small" muted>+ {em.label}</Text>
                    </Pressable>
                  ))}
                  {assignableModules.length === 0
                    ? <Text variant="small" muted>No assignable modules in this deploy.</Text>
                    : p.modules.length === 0 && <Text variant="small" muted>No modules yet — signs in to an empty app.</Text>}
                </View>
              ) : p.modules.length > 0 ? (
                <Text variant="small" muted>{p.modules.map((m) => moduleLabel(m.module)).join(', ')} · give app access to activate</Text>
              ) : null}
            </View>
          );
        })}
      </Card>

    </Screen>
  );
}
