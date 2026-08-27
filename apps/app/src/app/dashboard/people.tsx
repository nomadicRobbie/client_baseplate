import { useEffect, useState } from 'react';
import { View, Pressable, useWindowDimensions, TextInput } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Person, TeamUser } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/lib/profile-context';
import { availableModules } from '@/lib/nav';
import { getAccessToken } from '@/lib/session';
import { listPeople, createPerson, updatePerson, listTeam, addTeamUser, setTeamUserActive, setPersonModule, removePersonModule } from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, GroupedCard, GRow, SectionLabel, Button, FieldRow, Badge, Checkbox } from '@/ui/components';

type Msg = { text: string; tone: 'success' | 'error' };
type ThemeT = ReturnType<typeof useTheme>;
const ROLES: ('member' | 'admin')[] = ['member', 'admin'];

const makeStyles = (t: ThemeT) => ({
  input: { backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  section: { gap: 8 },
  roleRow: { flexDirection: 'row' as const, gap: t.space.sm },
  roleSection: { paddingHorizontal: t.space.lg, paddingVertical: t.space.md, gap: t.space.sm },
  roleBtn: (sel: boolean, disabled: boolean) => ({ opacity: disabled ? 0.4 : 1, paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.pill, borderWidth: 1, borderColor: sel ? t.color.primary : t.color.border, backgroundColor: sel ? t.color.primary : 'transparent' }),
  checkboxRow: { paddingHorizontal: t.space.lg },
  personRow: { borderBottomWidth: 1, borderColor: t.color.border },
  personRowLast: { borderBottomWidth: 0 },
  personAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  personInfo: { flex: 1, gap: 2 },
  personAccess: { alignItems: 'center' as const, gap: t.space.md },
  badgeRow: { flexDirection: 'row' as const, gap: 4 },
  modulePad: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  subPad: { paddingHorizontal: 16, paddingBottom: 10 },
  moduleBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: t.color.surfaceAlt },
  moduleAdd: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed' as const, borderColor: t.color.border },
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
          style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={t.color.textMuted} />
          <Text variant="label" muted>Account</Text>
        </Pressable>
      )}
      {/* Add a person — roster only, or with app access (creates a login) */}
      <View style={s.section}>
        <SectionLabel>Add a person</SectionLabel>
        <GroupedCard>
          <FieldRow label="Name" displayValue={name}>
            <TextInput value={name} onChangeText={setName} placeholder="Full name"
              autoCapitalize="sentences" placeholderTextColor={t.color.textMuted} style={s.input} />
          </FieldRow>
          <FieldRow label="Email" displayValue={email}>
            <TextInput value={email} onChangeText={setEmail} placeholder="Optional (required for app access)"
              keyboardType="email-address" autoCapitalize="none" placeholderTextColor={t.color.textMuted} style={s.input} />
          </FieldRow>
          <FieldRow label="Phone" displayValue={phone} last={!giveAccess}>
            <TextInput value={phone} onChangeText={setPhone} placeholder="Optional"
              keyboardType="phone-pad" placeholderTextColor={t.color.textMuted} style={s.input} />
          </FieldRow>
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
        </GroupedCard>
        <View style={s.checkboxRow}>
          <Checkbox checked={giveAccess} onChange={setGiveAccess} label="Give app access (creates a sign-in)" />
        </View>
        <Button label="Add person" onPress={add} loading={busy} />
      </View>

      {/* Roster */}
      <View style={s.section}>
        <SectionLabel right={people.length > 0 ? <Text variant="small" muted>{people.length}</Text> : undefined}>Roster</SectionLabel>
        {loading ? <Text muted>Loading…</Text> : people.length === 0 ? <Text muted>No people yet.</Text> : (
          <GroupedCard>
            {people.map((p, idx) => {
              const login = p.user_id ? teamUsers.find((u) => u.id === p.user_id) : undefined;
              const isSelf = !!p.user_id && p.user_id === meId;
              const unassigned = assignableModules.filter((em) => !p.modules.some((m) => m.module === em.feature));
              const isLast = idx === people.length - 1;
              const isAdminUser = p.user_id && (login?.role === 'admin' || login?.role === 'super');
              return (
                <View key={p.id} style={[s.personRow, isLast && s.personRowLast]}>
                  <GRow last>
                    <View style={s.personAvatar}>
                      <Ionicons name="person-outline" size={18} color={t.color.textMuted} />
                    </View>
                    <View style={s.personInfo}>
                      <Text variant="label">{p.name}</Text>
                      {!!(p.email || p.phone) && <Text variant="small" muted>{[p.email, p.phone].filter(Boolean).join(' · ')}</Text>}
                    </View>
                    {p.user_id ? (
                      <View style={s.personAccess}>
                        <View style={s.badgeRow}>
                          <Badge label={login?.role ?? 'app access'} tone={login?.role === 'super' ? 'accent' : 'neutral'} />
                          {login && !login.active && <Badge label="disabled" tone="neutral" />}
                        </View>
                        {login && !isSelf && login.role !== 'super' && (
                          <Pressable onPress={() => toggleLogin(p.user_id!, !login.active)} accessibilityRole="button">
                            <Text variant="small" color={login.active ? t.color.accent : t.color.success}>{login.active ? 'Disable' : 'Enable'}</Text>
                          </Pressable>
                        )}
                      </View>
                    ) : (
                      <Pressable onPress={() => giveAppAccess(p)} accessibilityRole="button" disabled={busy}>
                        <Text variant="small" color={t.color.primary}>Give access</Text>
                      </Pressable>
                    )}
                  </GRow>
                  {isAdminUser ? (
                    <View style={s.subPad}>
                      <Text variant="small" muted>Full access — admins see every module.</Text>
                    </View>
                  ) : p.user_id ? (
                    <View style={s.modulePad}>
                      {p.modules.map((m) => (
                        <Pressable key={m.module} onPress={() => unassign(p, m.module)} accessibilityRole="button" accessibilityLabel={`Remove ${moduleLabel(m.module)}`}
                          style={s.moduleBadge}>
                          <Text variant="small">{moduleLabel(m.module)}</Text>
                          <Text variant="small" muted>✕</Text>
                        </Pressable>
                      ))}
                      {unassigned.map((em) => (
                        <Pressable key={em.feature} onPress={() => assign(p, em.feature as string)} accessibilityRole="button" accessibilityLabel={`Assign ${em.label}`}
                          style={s.moduleAdd}>
                          <Text variant="small" muted>+ {em.label}</Text>
                        </Pressable>
                      ))}
                      {assignableModules.length === 0 && <Text variant="small" muted>No assignable modules.</Text>}
                      {assignableModules.length > 0 && p.modules.length === 0 && <Text variant="small" muted>No modules — signs in to an empty app.</Text>}
                    </View>
                  ) : p.modules.length > 0 ? (
                    <View style={s.subPad}>
                      <Text variant="small" muted>{p.modules.map((m) => moduleLabel(m.module)).join(', ')} · give access to activate</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </GroupedCard>
        )}
      </View>

    </Screen>
  );
}
