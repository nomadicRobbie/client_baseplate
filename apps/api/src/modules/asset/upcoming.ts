import { schedulesWithLastCompleted, type ScheduleDueRow } from '../../db/queries/asset'

// "Coming up" feed — derives each active maintenance schedule's next-due date and
// status (the PDF's "derived current state"). Next due = last completion + interval,
// or the schedule's initial due date if never completed. Date-based intervals only
// for now (Months/Weeks/Days/Years); hours/usage-based intervals need usage readings
// and fall back to the initial due date. ponytail: usage-interval math lands when
// trip/usage readings do.

export type UpcomingLevel = 'ok' | 'due' | 'over'
export interface UpcomingItem {
  kind: 'maintenance'
  id: string
  asset_id: string
  title: string
  subtitle: string | null
  due_date: string | null
  level: UpcomingLevel
}

function addInterval(fromISO: string, type: string | null, value: string | null): Date | null {
  const d = new Date(fromISO)
  if (isNaN(d.getTime())) return null
  const n = Number(value) || 0
  switch ((type ?? '').toLowerCase()) {
    case 'day': case 'days':   d.setUTCDate(d.getUTCDate() + n); return d
    case 'week': case 'weeks':  d.setUTCDate(d.getUTCDate() + n * 7); return d
    case 'month': case 'months': d.setUTCMonth(d.getUTCMonth() + n); return d
    case 'year': case 'years':  d.setUTCFullYear(d.getUTCFullYear() + n); return d
    default: return null   // hours/usage-based — not date-derivable yet
  }
}

function nextDue(sc: ScheduleDueRow): Date | null {
  if (sc.last_completed) {
    const next = addInterval(sc.last_completed, sc.interval_type, sc.interval_value)
    if (next) return next
  }
  return sc.initial_due_date ? new Date(sc.initial_due_date) : null
}

// The "due soon" window in days = the LARGEST configured alert (e.g. a 7-day alert
// makes it show as due-soon from a week out). Falls back to the legacy alert_days.
function windowDays(sc: ScheduleDueRow): number {
  const alerts = Array.isArray(sc.alerts) ? sc.alerts : []
  if (alerts.length) {
    const toDays = (a: { value: number; unit: string }) =>
      a.unit === 'hours' ? Number(a.value) / 24 : a.unit === 'weeks' ? Number(a.value) * 7 : Number(a.value)
    return Math.max(...alerts.map(toDays))
  }
  return sc.alert_days ?? 0
}

function levelFor(due: Date, windowInDays: number): UpcomingLevel {
  const todayStr = new Date().toISOString().slice(0, 10)
  const dueStr = due.toISOString().slice(0, 10)
  if (dueStr < todayStr) return 'over'
  const soon = new Date(); soon.setUTCDate(soon.getUTCDate() + windowInDays)
  return dueStr <= soon.toISOString().slice(0, 10) ? 'due' : 'ok'
}

// Returns upcoming maintenance sorted by due date (undated last). Every active
// schedule is included so the dashboard can show ok/due/over at a glance.
export async function buildUpcoming(assetId?: string): Promise<UpcomingItem[]> {
  const schedules = await schedulesWithLastCompleted(assetId)
  const items = schedules.map((sc): UpcomingItem => {
    const due = nextDue(sc)
    return {
      kind: 'maintenance',
      id: sc.id,
      asset_id: sc.asset_id,
      title: sc.task_name,
      subtitle: null,   // client formats due_date (dd/mm/yyyy)
      due_date: due ? due.toISOString().slice(0, 10) : null,
      level: due ? levelFor(due, windowDays(sc)) : 'ok',
    }
  })
  // Overdue first, then soonest due; undated last.
  const rank = { over: 0, due: 1, ok: 2 } as const
  return items.sort((a, b) =>
    rank[a.level] - rank[b.level] ||
    (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
}
