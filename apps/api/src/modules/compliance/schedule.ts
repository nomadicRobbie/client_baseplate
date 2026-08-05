import type { ComplianceSchedule } from '@blnk/shared'

// Is a recurring schedule due on a given calendar date? Pure date logic — the
// caller passes the date to check (the device's local "today"). Kept separate
// and tested because the recurrence rules are the fiddly part.

type Sched = Pick<ComplianceSchedule, 'active' | 'cadence' | 'weekdays' | 'day_of_month' | 'interval_days' | 'anchor_date'>

function startOfDayUTC(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

export function isDueOn(sched: Sched, date: Date): boolean {
  if (!sched.active) return false
  switch (sched.cadence) {
    case 'daily':
      return true
    case 'weekly':
      return sched.weekdays.includes(date.getDay())
    case 'monthly': {
      if (sched.day_of_month == null) return false
      // Clamp to month end so day 31 still fires in short months.
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      return date.getDate() === Math.min(sched.day_of_month, lastDay)
    }
    case 'interval': {
      if (!sched.interval_days || sched.interval_days < 1 || !sched.anchor_date) return false
      const anchor = new Date(sched.anchor_date + 'T00:00:00')
      const days = Math.round((startOfDayUTC(date) - startOfDayUTC(anchor)) / 86_400_000)
      return days >= 0 && days % sched.interval_days === 0
    }
    default:
      return false
  }
}

// ── Self-check: `tsx src/modules/compliance/schedule.ts` ────────────────────
function demo(): void {
  const base = { active: true, weekdays: [], day_of_month: null, interval_days: null, anchor_date: null }
  const eq = (got: boolean, want: boolean, msg: string) => {
    if (got !== want) throw new Error(`FAIL ${msg}: got ${got}, want ${want}`)
  }
  const wed = new Date('2026-08-05T09:00:00') // a Wednesday (getDay() === 3)
  eq(isDueOn({ ...base, cadence: 'daily' }, wed), true, 'daily always due')
  eq(isDueOn({ ...base, cadence: 'weekly', weekdays: [3] }, wed), true, 'weekly Wed on Wed')
  eq(isDueOn({ ...base, cadence: 'weekly', weekdays: [1, 4] }, wed), false, 'weekly Mon/Thu not Wed')
  eq(isDueOn({ ...base, cadence: 'monthly', day_of_month: 5 }, wed), true, 'monthly 5th on the 5th')
  eq(isDueOn({ ...base, cadence: 'monthly', day_of_month: 6 }, wed), false, 'monthly 6th not on 5th')
  eq(isDueOn({ ...base, cadence: 'monthly', day_of_month: 31 }, new Date('2026-02-28T00:00:00')), true, 'monthly 31 clamps to Feb end')
  eq(isDueOn({ ...base, cadence: 'interval', interval_days: 3, anchor_date: '2026-08-02' }, wed), true, 'interval every 3d hits day 3')
  eq(isDueOn({ ...base, cadence: 'interval', interval_days: 3, anchor_date: '2026-08-03' }, wed), false, 'interval off-cycle')
  eq(isDueOn({ ...base, active: false, cadence: 'daily' }, wed), false, 'inactive never due')
  console.log('compliance schedule: all checks passed')
}

if (require.main === module) demo()
