import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { RosterDetail, RosterRules, RosterServiceRow, EligibleCrew, RosterShift, OpenShift } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import {
  getRoster, getEligibleCrew, addRosterShift, removeRosterShift,
  publishRoster, deleteRoster as apiDeleteRoster, respondToAssignment,
  listOpenShifts, acceptShiftCover,
  generateRoster as apiGenerateRoster,
  getRosterRules,
} from '@/lib/api';
import { useTheme } from '@/theme';
import { Screen, Text, Card, GroupedCard, GRow, Button, Badge, Notice } from '@/ui/components';
import { localDate } from '@/lib/format';

type ThemeT = ReturnType<typeof useTheme>;
type Msg = { text: string; tone: 'success' | 'error' };

const makeStyles = (t: ThemeT) => ({
  backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, marginBottom: -4 },
  header: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const, gap: t.space.sm },
  headerLeft: { flex: 1, gap: 4 },
  headerActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md, paddingTop: 4 },
  metaRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, alignItems: 'center' as const },
  svcHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, paddingHorizontal: 16, paddingVertical: 12 },
  svcHeadLeft: { flex: 1, gap: 2 },
  svcTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  svcMeta: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, alignItems: 'center' as const },
  avatarRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingLeft: 6 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: t.color.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: t.color.surface,
    marginLeft: -6,
  },
  shiftBody: { flex: 1, gap: 2 },
  addBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.xs },
  empty: { alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.xl },
  respondRow: { flexDirection: 'row' as const, gap: t.space.sm },
  section: { gap: t.space.sm },
  // Week grid
  gridScroll: { marginHorizontal: -t.space.lg },
  gridRow: { flexDirection: 'row' as const, paddingHorizontal: t.space.lg, gap: 6 },
  dayCol: { width: 120, gap: 4 },
  dayHeader: {
    paddingVertical: t.space.xs,
    alignItems: 'center' as const,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    marginBottom: 4,
  },
  dayHeaderToday: { backgroundColor: t.color.primary, borderRadius: t.radius.sm },
  svcBlock: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.sm,
    padding: t.space.sm,
    gap: 2,
  },
});

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });

function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const f = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  return `${f(start)} – ${f(end)}`;
}

function shiftStatus(sh: RosterShift): 'confirmed' | 'declined' | 'pending' {
  if (sh.confirmed_at) return 'confirmed';
  if (sh.declined_at) return 'declined';
  return 'pending';
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function weekDays(weekStart: string): string[] {
  const d = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    return localDate(dd);
  });
}

function serviceDate(sv: RosterServiceRow, tz: string): string {
  const d = new Date(sv.starts_at);
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

function WeekGrid({ services, weekStart, t, s }: {
  services: RosterServiceRow[];
  weekStart: string;
  t: ThemeT;
  s: ReturnType<typeof makeStyles>;
}) {
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, RosterServiceRow[]>();
    for (const d of days) map.set(d, []);
    for (const sv of services) {
      const d = serviceDate(sv, sv.timezone);
      map.get(d)?.push(sv);
    }
    return map;
  }, [services, days]);

  const todayStr = localDate();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.gridScroll}>
      <View style={s.gridRow}>
        {days.map((day, i) => {
          const daySvcs = byDay.get(day) ?? [];
          const isToday = day === todayStr;
          const dayNum = new Date(`${day}T00:00:00`).getDate();
          return (
            <View key={day} style={s.dayCol}>
              <View style={[s.dayHeader, isToday && s.dayHeaderToday]}>
                <Text
                  variant="small"
                  color={isToday ? t.color.primaryText : t.color.textMuted}
                >
                  {DAY_LABELS[i]} {dayNum}
                </Text>
              </View>
              {daySvcs.length === 0 ? (
                <Text variant="small" muted>–</Text>
              ) : (
                daySvcs.map(sv => {
                  const status = sv.shifts.length === 0
                    ? 'No staff'
                    : sv.shortfall > 0
                      ? `${sv.shortfall} short`
                      : 'Staffed';
                  const statusColor = sv.shifts.length === 0 || sv.shortfall > 0
                    ? t.color.danger
                    : t.color.success;
                  return (
                    <View key={sv.service_id} style={s.svcBlock}>
                      <Text variant="small" numberOfLines={1}>{sv.name}</Text>
                      <Text variant="small" numberOfLines={1} color={statusColor}>{status}</Text>
                    </View>
                  );
                })
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export default function RosterDetailScreen() {
  const { rosterId } = useLocalSearchParams<{ rosterId: string }>();
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super';

  const [detail, setDetail] = useState<RosterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [expandedSvc, setExpandedSvc] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<EligibleCrew[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);

  const [rules, setRules] = useState<RosterRules | null>(null);

  // Cover flow state
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);

  const load = useCallback(async () => {
    if (!rosterId) return;
    setLoading(true);
    try {
      const tok = getAccessToken()!;
      const [d, rulesRes] = await Promise.all([
        getRoster(tok, rosterId),
        getRosterRules(tok).catch(() => null),
      ]);
      setDetail(d);
      if (rulesRes) setRules(rulesRes.rules);
      if (d.roster.status === 'published') {
        const os = await listOpenShifts(getAccessToken()!, rosterId);
        setOpenShifts(os.shifts);
      }
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [rosterId]);

  useEffect(() => { void load(); }, [load]);

  const openPicker = async (serviceId: string, override = false) => {
    setPickerFor(serviceId);
    setCandidates([]);
    setOverrideMode(override);
    setLoadingCandidates(true);
    try {
      const r = await getEligibleCrew(getAccessToken()!, rosterId!, serviceId, override);
      setCandidates(r.crew);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoadingCandidates(false);
    }
  };

  const assign = async (serviceId: string, c: EligibleCrew) => {
    setBusy(c.person_id);
    try {
      await addRosterShift(getAccessToken()!, rosterId!, {
        service_id: serviceId,
        person_id: c.person_id,
        asset_id: c.asset_id,
        role: c.role,
        rule_override: !!c.blocked_reason,
      });
      setPickerFor(null);
      setOverrideMode(false);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const unassign = async (shiftId: string) => {
    setBusy(shiftId);
    try {
      await removeRosterShift(getAccessToken()!, rosterId!, shiftId);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const doRegenerate = async () => {
    if (!detail?.roster) return;
    setRegenerating(true);
    try {
      await apiGenerateRoster(getAccessToken()!, detail.roster.week_start);
      setMsg({ text: 'Roster regenerated.', tone: 'success' });
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setRegenerating(false);
    }
  };

  const doPublish = async () => {
    setPublishing(true);
    try {
      await publishRoster(getAccessToken()!, rosterId!);
      setMsg({ text: 'Roster published — crew have been notified.', tone: 'success' });
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setPublishing(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await apiDeleteRoster(getAccessToken()!, rosterId!);
      setMsg({ text: 'Roster deleted — crew have been notified.', tone: 'success' });
      router.replace('/dashboard/roster');
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
      setDeleting(false);
    }
  };

  const respond = async (assignmentId: string, action: 'confirm' | 'decline') => {
    setBusy(assignmentId);
    try {
      await respondToAssignment(getAccessToken()!, rosterId!, assignmentId, action);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const cover = async (assignmentId: string) => {
    setBusy(assignmentId);
    try {
      await acceptShiftCover(getAccessToken()!, rosterId!, assignmentId);
      setMsg({ text: 'Shift accepted — you\'re on it.', tone: 'success' });
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const roster = detail?.roster;
  const services = detail?.services ?? [];
  const totalShifts = services.reduce((n, sv) => n + sv.shifts.length, 0);
  const isPublished = roster?.status === 'published';
  const declinedCount = isPublished
    ? services.reduce((n, sv) => n + sv.shifts.filter(sh => sh.declined_at).length, 0)
    : 0;

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <Pressable onPress={() => router.replace('/dashboard/roster')} style={s.backBtn} accessibilityRole="button">
        <Ionicons name="chevron-back-outline" size={16} color={t.color.primary} />
        <Text variant="small" color={t.color.primary}>Roster</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : !roster ? (
        <Text muted>Roster not found.</Text>
      ) : (
        <>
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Text variant="title">{weekLabel(roster.week_start)}</Text>
              <View style={s.metaRow}>
                <Badge
                  label={isPublished ? 'Published' : 'Draft'}
                  tone={isPublished ? 'success' : 'neutral'}
                />
                {isAdmin && <Text variant="small" muted>{totalShifts} shift{totalShifts !== 1 ? 's' : ''}</Text>}
                {isAdmin && isPublished && declinedCount > 0 && (
                  <Badge label={`${declinedCount} need${declinedCount !== 1 ? '' : 's'} cover`} tone="accent" />
                )}
              </View>
            </View>
            {isAdmin && (
              <View style={s.headerActions}>
                <Pressable onPress={doRegenerate} disabled={regenerating} accessibilityRole="button" accessibilityLabel="Regenerate roster">
                  {regenerating
                    ? <ActivityIndicator size="small" color={t.color.primary} />
                    : <Ionicons name="refresh-outline" size={22} color={t.color.primary} />}
                </Pressable>
                {!isPublished && (
                  <Pressable onPress={doPublish} disabled={publishing} accessibilityRole="button" accessibilityLabel="Publish roster">
                    {publishing
                      ? <ActivityIndicator size="small" color={t.color.primary} />
                      : <Ionicons name="send-outline" size={20} color={t.color.primary} />}
                  </Pressable>
                )}
                <Pressable onPress={() => setConfirmDelete(true)} accessibilityRole="button" accessibilityLabel="Delete roster">
                  <Ionicons name="trash-outline" size={20} color={t.color.danger} />
                </Pressable>
              </View>
            )}
          </View>

          {isAdmin && confirmDelete && (
            <Card>
              <Text variant="small" color={t.color.danger}>
                {isPublished
                  ? 'This will remove all assignments. Staff will be notified.'
                  : 'Delete this draft?'}
              </Text>
              <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
                <Button label="Delete" variant="ghost" onPress={doDelete} loading={deleting} />
                <Button label="Cancel" variant="ghost" onPress={() => setConfirmDelete(false)} />
              </View>
            </Card>
          )}

          {isAdmin && services.length > 0 && (
            <WeekGrid
              services={services}
              weekStart={roster.week_start}
              t={t}
              s={s}
            />
          )}

          {/* Open shifts for cover — member view on published rosters */}
          {!isAdmin && isPublished && openShifts.length > 0 && (
            <View style={s.section}>
              <Text variant="label">Cover needed</Text>
              <GroupedCard>
                {openShifts.map((os, i) => (
                  <GRow key={os.assignment_id} last={i === openShifts.length - 1}>
                    <View style={s.shiftBody}>
                      <Text variant="body">{os.service_name}</Text>
                      <Text variant="small" muted>
                        {fmtDay(os.starts_at)} · {fmtTime(os.starts_at)}–{fmtTime(os.ends_at)}
                        {os.location_label ? ` · ${os.location_label}` : ''}
                      </Text>
                      <Text variant="small" muted>
                        Covering for {os.declined_person_name} · {os.role ?? 'Crew'}
                      </Text>
                    </View>
                    <Button
                      label="Accept"
                      onPress={() => cover(os.assignment_id)}
                      loading={busy === os.assignment_id}
                    />
                  </GRow>
                ))}
              </GroupedCard>
            </View>
          )}

          {services.length === 0 ? (
            <View style={s.empty}>
              <Ionicons name="calendar-clear-outline" size={32} color={t.color.textMuted} />
              <Text muted>
                {isAdmin ? 'Nothing scheduled this week.' : 'You have no shifts this week.'}
              </Text>
            </View>
          ) : (
            services.map(sv => {
              const isExpanded = expandedSvc === sv.service_id;
              return (
              <GroupedCard key={sv.service_id}>
                <Pressable
                  onPress={() => setExpandedSvc(isExpanded ? null : sv.service_id)}
                  accessibilityRole="button"
                  style={s.svcHead}
                >
                  <View style={s.svcHeadLeft}>
                    <View style={s.svcTitleRow}>
                      <Text variant="label">{sv.name}</Text>
                      {!sv.has_asset && <Badge label="No asset" tone="accent" />}
                      {sv.has_asset && sv.shortfall > 0 && (
                        <Badge label={`${sv.shortfall} short`} tone="accent" />
                      )}
                    </View>
                    <Text variant="small" muted>
                      {fmtDay(sv.starts_at)} · {fmtTime(sv.starts_at)}–{fmtTime(sv.ends_at)}
                      {sv.location_label ? ` · ${sv.location_label}` : ''}
                    </Text>
                  </View>
                  {sv.shifts.length > 0 && (
                    <View style={s.avatarRow}>
                      {sv.shifts.map(sh => (
                        <View key={sh.id} style={s.avatar}>
                          <Text variant="small" color={t.color.primaryText}>{initials(sh.person_name)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <Ionicons
                    name={isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                    size={16}
                    color={t.color.textMuted}
                  />
                </Pressable>

                {isExpanded && !sv.has_asset ? (
                  <GRow last>
                    <View style={s.shiftBody}>
                      <Text variant="small" muted>
                        Assign an asset to this service and crew can be worked out from it.
                      </Text>
                    </View>
                    {isAdmin && (
                      <Pressable
                        onPress={() => router.push({
                          pathname: '/dashboard/schedule/[serviceId]/assign',
                          params: { serviceId: sv.service_id },
                        })}
                        accessibilityRole="button"
                        accessibilityLabel={`Assign an asset to ${sv.name}`}
                      >
                        <Ionicons name="cube-outline" size={20} color={t.color.primary} />
                      </Pressable>
                    )}
                  </GRow>
                ) : isExpanded && sv.shifts.length === 0 ? (
                  <GRow last>
                    <View style={s.shiftBody}>
                      <Text variant="small" muted>
                        {sv.gap_reason ?? 'Nobody rostered.'}
                      </Text>
                    </View>
                    {isAdmin && isPublished && (
                      <Pressable
                        onPress={() => router.push({
                          pathname: '/dashboard/schedule/[serviceId]/assign',
                          params: { serviceId: sv.service_id },
                        })}
                        accessibilityRole="button"
                        accessibilityLabel={`Assign crew to ${sv.name}`}
                      >
                        <Ionicons name="person-add-outline" size={18} color={t.color.primary} />
                      </Pressable>
                    )}
                  </GRow>
                ) : isExpanded ? (
                  sv.shifts.map((sh, i) => {
                    const status = shiftStatus(sh);
                    const isLast = i === sv.shifts.length - 1 && pickerFor !== sv.service_id;
                    return (
                      <GRow key={sh.id} last={isLast}>
                        <View style={s.shiftBody}>
                          <Text variant="body">{sh.person_name}</Text>
                          <Text variant="small" muted>
                            {sh.role ?? 'Crew'}
                            {sh.asset_name ? ` · ${sh.asset_name}` : ''}
                            {isPublished && (
                              status === 'confirmed' ? ' · Confirmed'
                              : status === 'declined' ? ' · Needs cover'
                              : ' · Pending'
                            )}
                          </Text>
                          {sh.rule_override && (
                            <Badge label="Override" tone="accent" />
                          )}

                          {!isAdmin && isPublished && status === 'pending' && (
                            <View style={s.respondRow}>
                              <Button
                                label="Confirm"
                                onPress={() => respond(sh.id, 'confirm')}
                                loading={busy === sh.id}
                              />
                              <Button
                                variant="ghost"
                                label="Decline"
                                onPress={() => respond(sh.id, 'decline')}
                                loading={busy === sh.id}
                              />
                            </View>
                          )}
                          {!isAdmin && isPublished && status === 'confirmed' && (
                            <Badge label="Confirmed" tone="success" />
                          )}
                          {!isAdmin && isPublished && status === 'declined' && (
                            <Badge label="Declined" tone="accent" />
                          )}
                        </View>
                        {isAdmin && !isPublished && (
                          <Pressable
                            onPress={() => unassign(sh.id)}
                            disabled={busy === sh.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${sh.person_name} from ${sv.name}`}
                          >
                            <Ionicons
                              name="close-circle-outline"
                              size={22}
                              color={busy === sh.id ? t.color.textMuted : t.color.danger}
                            />
                          </Pressable>
                        )}
                      </GRow>
                    );
                  })
                ) : null}

                {isExpanded && isAdmin && !isPublished && sv.has_asset && (
                  <GRow>
                    <Pressable
                      onPress={() => (pickerFor === sv.service_id ? setPickerFor(null) : openPicker(sv.service_id))}
                      accessibilityRole="button"
                      accessibilityLabel={`Add crew to ${sv.name}`}
                      style={s.addBtn}
                    >
                      <Ionicons
                        name={pickerFor === sv.service_id ? 'close-outline' : 'person-add-outline'}
                        size={18}
                        color={t.color.primary}
                      />
                      <Text variant="small" color={t.color.primary}>
                        {pickerFor === sv.service_id ? 'Cancel' : 'Add crew'}
                      </Text>
                    </Pressable>
                  </GRow>
                )}

                {pickerFor === sv.service_id && isExpanded && (
                  loadingCandidates ? (
                    <GRow last><ActivityIndicator color={t.color.primary} /></GRow>
                  ) : candidates.length === 0 && !overrideMode ? (
                    <GRow last>
                      <View style={s.shiftBody}>
                        <Text variant="small" muted>
                          Nobody else is free — everyone who crews this asset is off or already booked.
                        </Text>
                        <Pressable
                          onPress={() => openPicker(sv.service_id, true)}
                          accessibilityRole="button"
                          style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs, marginTop: t.space.xs }}
                        >
                          <Ionicons name="warning-outline" size={14} color={t.color.accent} />
                          <Text variant="small" color={t.color.accent}>Override rules</Text>
                        </Pressable>
                      </View>
                    </GRow>
                  ) : candidates.length === 0 && overrideMode ? (
                    <GRow last>
                      <Text variant="small" muted>
                        No crew assigned to this asset at all.
                      </Text>
                    </GRow>
                  ) : (
                    <>
                      {!overrideMode && candidates.length > 0 && (
                        <GRow>
                          <View style={s.shiftBody}>
                            <Pressable
                              onPress={() => openPicker(sv.service_id, true)}
                              accessibilityRole="button"
                              style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}
                            >
                              <Ionicons name="warning-outline" size={14} color={t.color.accent} />
                              <Text variant="small" color={t.color.accent}>Show all crew (override rules)</Text>
                            </Pressable>
                          </View>
                        </GRow>
                      )}
                      {overrideMode && (
                        <GRow>
                          <View style={s.shiftBody}>
                            <Pressable
                              onPress={() => openPicker(sv.service_id, false)}
                              accessibilityRole="button"
                              style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}
                            >
                              <Ionicons name="shield-checkmark-outline" size={14} color={t.color.primary} />
                              <Text variant="small" color={t.color.primary}>Show eligible only (apply rules)</Text>
                            </Pressable>
                          </View>
                        </GRow>
                      )}
                      {candidates.map((c, i) => (
                        <GRow key={c.person_id} last={i === candidates.length - 1}>
                          <View style={s.shiftBody}>
                            <Text variant="body">{c.name}</Text>
                            <Text variant="small" muted>{c.role ?? 'Crew'} · {c.asset_name}</Text>
                            {c.blocked_reason && (
                              <Text variant="small" color={t.color.accent}>{c.blocked_reason}</Text>
                            )}
                          </View>
                          <Button
                            label={c.blocked_reason ? 'Override' : 'Add'}
                            onPress={() => assign(sv.service_id, c)}
                            loading={busy === c.person_id}
                          />
                        </GRow>
                      ))}
                    </>
                  )
                )}
              </GroupedCard>
              );
            })
          )}
        </>
      )}
    </Screen>
  );
}
