import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Pressable, ActivityIndicator, TextInput, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { FeedItem, FeedFaultData, FeedMaintenanceData, FeedPost, FeedPostComment, FeedComplianceData, FeedServiceData, Person } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { useFeedBadge } from '@/lib/feed-badge-context';
import { getAccessToken } from '@/lib/session';
import { getFeed, createFeedPost, deleteFeedPost, listPostComments, createPostComment, listPeople } from '@/lib/api';
import { formatDMY, isoToLocalDate } from '@/lib/format';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Button, Badge } from '@/ui/components';
import { StatusBadge, urgencyLevel } from '@/ui/status';
import { NAV } from '@/lib/nav';

const MODULE_LABEL: Record<string, string> = Object.fromEntries(
  NAV.filter(n => n.feature).map(n => [n.feature!, n.label])
);
const moduleLabel = (key: string) => MODULE_LABEL[key] ?? key;

type ThemeT = ReturnType<typeof useTheme>;
const makeStyles = (t: ThemeT) => ({
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  composeToggle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.sm, minHeight: 44 },
  scopeRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  pill: (sel: boolean) => ({
    paddingVertical: t.space.sm, paddingHorizontal: t.space.md,
    borderRadius: t.radius.pill, borderWidth: 1,
    borderColor: sel ? t.color.primary : t.color.border,
    backgroundColor: sel ? t.color.primary : 'transparent',
  }),
  mentionList: {
    backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
    borderRadius: t.radius.md, marginTop: 2, maxHeight: 160, overflow: 'hidden' as const,
  },
  mentionRow: {
    paddingVertical: t.space.sm, paddingHorizontal: t.space.md,
  },
  composeActions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: t.space.sm },
  feedItem: { gap: t.space.xs },
  itemRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: t.space.sm },
  itemIcon: { marginTop: 2 },
  itemBody: { flex: 1, gap: 4 },
  itemMeta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, flexWrap: 'wrap' as const },
  deleteBtn: { padding: 4 },
  postAvatar: { width: 32, height: 32, borderRadius: 16 },
  postAvatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: t.color.border, alignItems: 'center' as const, justifyContent: 'center' as const },
  stepPreview: {
    marginTop: t.space.xs, paddingLeft: t.space.sm,
    borderLeftWidth: 2, borderLeftColor: t.color.border,
  },
  commentRow: { gap: 2, paddingLeft: t.space.sm, borderLeftWidth: 2, borderLeftColor: t.color.border },
  commentInputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  commentInput: {
    flex: 1, backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
    borderRadius: t.radius.md, padding: t.space.sm, height: 44,
    fontSize: t.size.md, color: t.color.text,
  },
  threadToggle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.xs, marginTop: t.space.xs },
  empty: { alignItems: 'center' as const, gap: t.space.sm, paddingVertical: t.space.xl },
  textarea: {
    backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
    borderRadius: t.radius.md, padding: t.space.md, minHeight: 88,
    fontSize: t.size.md, color: t.color.text, textAlignVertical: 'top' as const,
  },
});

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return formatDMY(isoToLocalDate(iso))
}

// ── Fault item — tappable, shows step count + latest step preview ─────────────
function FaultItem({
  data, t, s,
}: { data: FeedFaultData; t: ThemeT; s: ReturnType<typeof makeStyles> }) {
  const router = useRouter()
  const stepLabel = data.step_count === 1 ? '1 update' : `${data.step_count} updates`

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/dashboard/asset/[assetId]/faults', params: { assetId: data.asset_id } })}
      accessibilityRole="button"
      accessibilityLabel={`View fault: ${data.fault_name}`}
    >
      <View style={s.itemRow}>
        <Ionicons name="warning-outline" size={18} color={t.color.danger} style={s.itemIcon} />
        <View style={s.itemBody}>
          <Text variant="label">{data.asset_name}</Text>
          <Text variant="body">{data.fault_name}</Text>
          <View style={s.itemMeta}>
            {data.urgency && <StatusBadge level={urgencyLevel(data.urgency)} label={data.urgency} />}
            <Badge label="Asset Manager" tone="neutral" />
            {data.step_count > 0 && (
              <Text variant="small" muted>{stepLabel} · tap to view</Text>
            )}
          </View>
          {data.latest_step && (
            <View style={s.stepPreview}>
              <Text variant="small" numberOfLines={2}>{data.latest_step.note}</Text>
              <Text variant="small" muted>{relativeTime(data.latest_step.created_at)}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward-outline" size={16} color={t.color.textMuted} />
      </View>
    </Pressable>
  )
}

// ── Maintenance item — informational, no comments ─────────────────────────────
function MaintenanceItem({ data, t, s }: { data: FeedMaintenanceData; t: ThemeT; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.itemRow}>
      <Ionicons name="construct-outline" size={18} color={t.color.accent} style={s.itemIcon} />
      <View style={s.itemBody}>
        <Text variant="label">{data.asset_name}</Text>
        <Text variant="body">{data.task_name}</Text>
        <View style={s.itemMeta}>
          <StatusBadge
            level={data.level === 'over' ? 'over' : 'due'}
            label={data.level === 'over' ? 'Overdue' : `Due ${formatDMY(data.due_date)}`}
          />
          <Badge label="Asset Manager" tone="neutral" />
        </View>
      </View>
    </View>
  )
}

// ── Post item — with expandable comment thread ────────────────────────────────
function PostItem({
  data, t, s, myUserId, isAdmin, onDelete,
}: {
  data: FeedPost; t: ThemeT; s: ReturnType<typeof makeStyles>
  myUserId: string; isAdmin: boolean; onDelete: (id: string) => void
}) {
  const tok = () => getAccessToken()!
  const canDelete = isAdmin || data.created_by === myUserId
  const scopeLabel = data.modules.length === 0 ? 'All staff' : data.modules.map(moduleLabel).join(' + ')

  const [expanded, setExpanded] = useState(false)
  const [comments, setComments] = useState<FeedPostComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadComments = useCallback(async () => {
    setLoadingComments(true)
    try {
      const r = await listPostComments(tok(), data.id)
      setComments(r.comments)
    } finally {
      setLoadingComments(false)
    }
  }, [data.id])

  const toggleThread = () => {
    if (!expanded) void loadComments()
    setExpanded(v => !v)
  }

  const submitComment = async () => {
    if (!commentBody.trim()) return
    setSubmitting(true)
    try {
      const r = await createPostComment(tok(), data.id, commentBody.trim())
      setComments(prev => [...prev, r.comment])
      setCommentBody('')
      setExpanded(false)
    } finally {
      setSubmitting(false)
    }
  }

  const threadLabel = data.comment_count === 0
    ? 'Add a comment'
    : data.comment_count === 1 ? '1 comment' : `${data.comment_count} comments`

  return (
    <View>
      <View style={s.itemRow}>
        {data.author_image_url
          ? <Image source={{ uri: data.author_image_url }} style={s.postAvatar} />
          : <View style={s.postAvatarPlaceholder}><Ionicons name="person" size={16} color={t.color.textMuted} /></View>
        }
        <View style={s.itemBody}>
          <Text variant="label">{data.author_name}</Text>
          <Text variant="body">{data.body}</Text>
          <View style={s.itemMeta}>
            <Badge label={scopeLabel} tone="neutral" />
          </View>
          {/* Latest comment preview when collapsed */}
          {!expanded && data.latest_comment && (
            <View style={s.stepPreview}>
              <Text variant="small" color={t.color.textMuted}>{data.latest_comment.author_name}</Text>
              <Text variant="small" numberOfLines={1}>{data.latest_comment.body}</Text>
            </View>
          )}
        </View>
        {canDelete && (
          <Pressable onPress={() => onDelete(data.id)} style={s.deleteBtn} accessibilityLabel="Delete post">
            <Ionicons name="trash-outline" size={16} color={t.color.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Thread toggle */}
      <Pressable onPress={toggleThread} style={s.threadToggle} accessibilityRole="button">
        <Ionicons
          name={expanded ? 'chatbubbles' : 'chatbubbles-outline'}
          size={14}
          color={t.color.textMuted}
        />
        <Text variant="small" muted>{threadLabel}</Text>
        {expanded && <Text variant="small" muted>· {relativeTime(data.created_at)}</Text>}
        {data.comment_count > 0 && (
          <Ionicons
            name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={12}
            color={t.color.textMuted}
          />
        )}
      </Pressable>

      {/* Expanded comment thread */}
      {expanded && (
        <View>
          {loadingComments ? (
            <ActivityIndicator size="small" color={t.color.primary} />
          ) : (
            comments.map(c => (
              <View key={c.id} style={[s.commentRow, { marginBottom: t.space.sm }]}>
                <Text variant="small" color={t.color.textMuted}>{c.author_name} · {relativeTime(c.created_at)}</Text>
                <Text variant="body">{c.body}</Text>
              </View>
            ))
          )}
          <View style={s.commentInputRow}>
            <TextInput
              value={commentBody}
              onChangeText={setCommentBody}
              placeholder="Write a comment…"
              placeholderTextColor={t.color.textMuted}
              style={s.commentInput}
            />
            <Button
              label="Comment"
              onPress={submitComment}
              loading={submitting}
              disabled={!commentBody.trim()}
            />
          </View>
        </View>
      )}
    </View>
  )
}

// ── Compliance item — incomplete scheduled checks for today ───────────────────
function ComplianceItem({ data, t, s }: { data: FeedComplianceData; t: ThemeT; s: ReturnType<typeof makeStyles> }) {
  const countLabel = data.remaining === 1
    ? '1 check not yet completed'
    : `${data.remaining} checks not yet completed`
  const doneLabel = data.times_per_day > 1 ? ` (${data.done_count}/${data.times_per_day} done)` : ''
  return (
    <View style={s.itemRow}>
      <Ionicons name="checkmark-circle-outline" size={18} color={t.color.warning ?? t.color.accent} style={s.itemIcon} />
      <View style={s.itemBody}>
        <Text variant="label">{data.label}</Text>
        <Text variant="body">{countLabel}{doneLabel}</Text>
        <View style={s.itemMeta}>
          <Badge label="Food Compliance" tone="neutral" />
        </View>
      </View>
    </View>
  )
}

// ── Service item — upcoming service with crew gaps ────────────────────────────
function ServiceItem({ data, t, s }: { data: FeedServiceData; t: ThemeT; s: ReturnType<typeof makeStyles> }) {
  const router = useRouter()
  const gapCount = data.unfilled_roles.reduce((n, r) => n + r.count, 0)
  const when = new Date(data.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const date = formatDMY(isoToLocalDate(data.starts_at))
  // No asset is the gap worth naming first: crew can't be worked out without one,
  // so an unfilled-roles count would just be a symptom of it.
  const gapLabel = !data.has_asset ? 'No asset assigned'
    : gapCount > 0 ? `${gapCount} role${gapCount !== 1 ? 's' : ''} unfilled`
    : 'Needs confirmation'
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/dashboard/schedule/[serviceId]', params: { serviceId: data.service_id } })}
      accessibilityRole="button"
      accessibilityLabel={`View service: ${data.name}`}
    >
      <View style={s.itemRow}>
        <Ionicons name="calendar-outline" size={18} color={t.color.primary} style={s.itemIcon} />
        <View style={s.itemBody}>
          <Text variant="label">{data.name}</Text>
          <Text variant="body">{date} · {when}{data.facility_name ? ` · ${data.facility_name}` : ''}</Text>
          <View style={s.itemMeta}>
            <StatusBadge level="due" label={gapLabel} />
            <Badge label="Schedule" tone="neutral" />
          </View>
        </View>
        <Ionicons name="chevron-forward-outline" size={16} color={t.color.textMuted} />
      </View>
    </Pressable>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
type Msg = { text: string; tone: 'success' | 'error' }
const tok = () => getAccessToken()!

export default function FeedScreen() {
  const t = useTheme()
  const s = makeStyles(t)
  const { user } = useAuth()
  const { markSeen, noteLatestAt } = useFeedBadge()

  const [items, setItems] = useState<FeedItem[]>([])
  const [myModules, setMyModules] = useState<string[]>([])
  const [availableModules, setAvailableModules] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<Msg | null>(null)

  const [composing, setComposing] = useState(false)
  const [postBody, setPostBody] = useState('')
  // pills: which modules are selected (empty = all staff)
  const [selectedModules, setSelectedModules] = useState<string[]>([])
  // mentions: person_ids tagged in this post
  const [mentions, setMentions] = useState<string[]>([])
  const [expiryOption, setExpiryOption] = useState<12 | 24 | 48 | 'eod' | null>(null)
  const [posting, setPosting] = useState(false)

  // @mention autocomplete
  const [people, setPeople] = useState<Person[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null) // null = picker closed
  const inputRef = useRef<TextInput>(null)

  const load = useCallback(async () => {
    try {
      const r = await getFeed(tok())
      setItems(r.items)
      setMyModules(r.my_modules)
      setAvailableModules(r.available_modules ?? [])
      noteLatestAt(r.items[0]?.created_at ?? null)
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [noteLatestAt])

  useEffect(() => { void load(); markSeen() }, [load, markSeen])

  // Lazy-load people with app access (user_id not null = can log in and see the feed).
  useEffect(() => {
    if (composing && people.length === 0) {
      listPeople(tok(), { active: true })
        .then(r => setPeople(r.people.filter(p => p.user_id !== null)))
        .catch(() => {})
    }
  }, [composing])

  const handleBodyChange = (text: string) => {
    setPostBody(text)
    // Detect trailing @query — find the last @ that isn't followed by a space yet.
    const match = text.match(/@([^\s]*)$/)
    setMentionQuery(match ? match[1] : null)
  }

  const selectMention = (person: Person) => {
    if (mentions.includes(person.id)) {
      setMentionQuery(null)
      return
    }
    // Replace the trailing @query with @Name
    const updated = postBody.replace(/@([^\s]*)$/, `@${person.name} `)
    setPostBody(updated)
    setMentions(prev => [...prev, person.id])
    setMentionQuery(null)
  }

  const toggleModule = (key: string) => {
    setSelectedModules(prev =>
      prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key]
    )
  }

  const resolveExpiresHours = (opt: 12 | 24 | 48 | 'eod'): number => {
    if (opt !== 'eod') return opt
    const now = new Date()
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0)
    return (midnight.getTime() - now.getTime()) / 3_600_000
  }

  const resetCompose = () => {
    setPostBody(''); setMentions([]); setSelectedModules([]); setMentionQuery(null); setExpiryOption(null); setComposing(false)
  }

  const submitPost = async () => {
    if (!postBody.trim()) return
    setPosting(true); setMsg(null)
    try {
      await createFeedPost(tok(), postBody.trim(), selectedModules, mentions, expiryOption ? resolveExpiresHours(expiryOption) : undefined)
      resetCompose()
      await load()
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' })
    } finally {
      setPosting(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteFeedPost(tok(), id)
      setItems(prev => prev.filter(i => i.kind !== 'post' || (i.data as FeedPost).id !== id))
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' })
    }
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'super'

  // Filtered mention suggestions — hide already-mentioned people.
  const mentionSuggestions = mentionQuery !== null
    ? people.filter(p =>
        p.name.toLowerCase().includes(mentionQuery.toLowerCase()) && !mentions.includes(p.id)
      ).slice(0, 6)
    : []

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <View style={s.header}>
        <Text variant="title">News Feed</Text>
      </View>

      {/* Compose */}
      <Card>
        <Pressable onPress={() => setComposing(v => !v)} accessibilityRole="button" style={s.composeToggle}>
          <Ionicons name="create-outline" size={18} color={t.color.textMuted} />
          <Text muted>{composing ? 'Cancel' : 'Write a post…'}</Text>
        </Pressable>

        {composing && (
          <>
            <TextInput
              ref={inputRef}
              value={postBody}
              onChangeText={handleBodyChange}
              placeholder="What's happening? Type @ to mention someone."
              placeholderTextColor={t.color.textMuted}
              multiline
              style={s.textarea}
            />

            {/* @mention inline picker */}
            {mentionSuggestions.length > 0 && (
              <ScrollView style={s.mentionList} keyboardShouldPersistTaps="always">
                {mentionSuggestions.map(p => (
                  <Pressable key={p.id} onPress={() => selectMention(p)} style={s.mentionRow}>
                    <Text variant="body">{p.name}</Text>
                    {p.email && <Text variant="small" muted>{p.email}</Text>}
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {/* Module visibility pills — admins see all modules, members see their own */}
            {availableModules.length > 0 && (
              <>
                <Text variant="label">
                  {'Visible to '}
                  <Text variant="label" color={t.color.textMuted}>
                    {selectedModules.length === 0 ? 'everyone' : `${selectedModules.map(moduleLabel).join(' and ')} members`}
                  </Text>
                </Text>
                <View style={s.scopeRow}>
                  {(isAdmin ? availableModules : myModules).map(key => {
                    const sel = selectedModules.includes(key)
                    return (
                      <Pressable
                        key={key}
                        onPress={() => toggleModule(key)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: sel }}
                        style={s.pill(sel)}
                      >
                        <Text variant="small" color={sel ? t.color.bg : t.color.text}>{moduleLabel(key)}</Text>
                      </Pressable>
                    )
                  })}
                  {selectedModules.length > 0 && (
                    <Pressable
                      onPress={() => setSelectedModules([])}
                      accessibilityRole="button"
                      style={s.pill(false)}
                    >
                      <Text variant="small" color={t.color.text}>All staff</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}

            {/* Auto-remove TTL pills + Post button flush on same row */}
            <Text variant="label">Auto-remove after</Text>
            <View style={s.composeActions}>
              <View style={[s.scopeRow, { flex: 1, alignItems: 'center' }]}>
                {([12, 24, 48, 'eod'] as const).map(opt => {
                  const sel = expiryOption === opt
                  const label = opt === 'eod' ? 'Today' : `${opt}h`
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setExpiryOption(sel ? null : opt)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: sel }}
                      style={s.pill(sel)}
                    >
                      <Text variant="small" color={sel ? t.color.bg : t.color.text}>{label}</Text>
                    </Pressable>
                  )
                })}
                {expiryOption !== null && (
                  <Pressable onPress={() => setExpiryOption(null)} accessibilityRole="button" accessibilityLabel="Clear auto-remove">
                    <Ionicons name="close-outline" size={18} color={t.color.textMuted} />
                  </Pressable>
                )}
              </View>
              <Button label="Post" onPress={submitPost} loading={posting} disabled={!postBody.trim()} />
            </View>
          </>
        )}
      </Card>

      {/* Feed */}
      {loading ? (
        <ActivityIndicator color={t.color.primary} />
      ) : items.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="newspaper-outline" size={32} color={t.color.textMuted} />
          <Text muted>Nothing to show yet.</Text>
        </View>
      ) : (
        items.map((item, idx) => {
          const tint =
            item.kind === 'fault'       ? { backgroundColor: t.color.warningMuted + '40' } :
            item.kind === 'maintenance' ? { backgroundColor: t.color.successMuted + '40' } :
            item.kind === 'compliance'  ? { backgroundColor: t.color.dangerMuted  + '40' } :
            item.kind === 'service'     ? { backgroundColor: t.color.primary      + '18' } :
            undefined
          return (
            <Card key={`${item.kind}-${idx}`} style={tint}>
              <View style={s.feedItem}>
                {item.kind === 'fault' && (
                  <FaultItem data={item.data as FeedFaultData} t={t} s={s} />
                )}
                {item.kind === 'maintenance' && (
                  <MaintenanceItem data={item.data as FeedMaintenanceData} t={t} s={s} />
                )}
                {item.kind === 'post' && (
                  <PostItem
                    data={item.data as FeedPost} t={t} s={s}
                    myUserId={user?.userId ?? ''}
                    isAdmin={isAdmin}
                    onDelete={handleDelete}
                  />
                )}
                {item.kind === 'compliance' && (
                  <ComplianceItem data={item.data as FeedComplianceData} t={t} s={s} />
                )}
                {item.kind === 'service' && (
                  <ServiceItem data={item.data as FeedServiceData} t={t} s={s} />
                )}
                {item.kind !== 'post' && <Text variant="small" muted>{relativeTime(item.created_at)}</Text>}
              </View>
            </Card>
          )
        })
      )}
    </Screen>
  )
}
