import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDueOn } from '../src/modules/compliance/schedule'

// Pure unit tests — no DB, no network.

const base = { active: true, weekdays: [] as number[], day_of_month: null, interval_days: null, anchor_date: null }

// 2026-08-05 is a Wednesday (getDay() === 3)
const WED = new Date('2026-08-05T09:00:00')
// 2026-08-03 is a Monday
const MON = new Date('2026-08-03T09:00:00')
// 2026-08-07 is a Friday
const FRI = new Date('2026-08-07T09:00:00')

test('daily: always due when active', () => {
  assert.equal(isDueOn({ ...base, cadence: 'daily' }, WED), true)
  assert.equal(isDueOn({ ...base, cadence: 'daily' }, MON), true)
})

test('inactive: never due regardless of cadence', () => {
  assert.equal(isDueOn({ ...base, active: false, cadence: 'daily' }, WED),   false)
  assert.equal(isDueOn({ ...base, active: false, cadence: 'weekly', weekdays: [3] }, WED), false)
})

test('weekly: fires on matching weekday only', () => {
  const wed = { ...base, cadence: 'weekly', weekdays: [3] }      // Wed
  assert.equal(isDueOn(wed, WED), true)
  assert.equal(isDueOn(wed, MON), false)
  assert.equal(isDueOn(wed, FRI), false)

  const monFri = { ...base, cadence: 'weekly', weekdays: [1, 5] }
  assert.equal(isDueOn(monFri, MON), true)
  assert.equal(isDueOn(monFri, FRI), true)
  assert.equal(isDueOn(monFri, WED), false)
})

test('monthly: fires on the correct day of month', () => {
  // 2026-08-05 → day 5
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: 5 }, WED), true)
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: 6 }, WED), false)
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: 4 }, WED), false)
})

test('monthly: day_of_month 31 clamps to last day of short months', () => {
  // Feb 2026 has 28 days
  const feb28 = new Date('2026-02-28T00:00:00')
  const feb27 = new Date('2026-02-27T00:00:00')
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: 31 }, feb28), true,  '31 → clamps to 28 in Feb')
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: 31 }, feb27), false, 'not the 27th')
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: 30 }, feb28), true,  '30 also clamps to 28 in Feb')

  // April has 30 days
  const apr30 = new Date('2026-04-30T00:00:00')
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: 31 }, apr30), true, '31 clamps to 30 in April')
})

test('monthly: day_of_month null → never due', () => {
  assert.equal(isDueOn({ ...base, cadence: 'monthly', day_of_month: null }, WED), false)
})

test('interval: fires on exact multiples from anchor, not between', () => {
  // anchor 2026-08-02, every 3 days → due on Aug 2, 5, 8, 11...
  const every3 = { ...base, cadence: 'interval', interval_days: 3, anchor_date: '2026-08-02' }
  assert.equal(isDueOn(every3, new Date('2026-08-02T00:00:00')), true,  'anchor day (day 0)')
  assert.equal(isDueOn(every3, new Date('2026-08-05T00:00:00')), true,  'day 3')
  assert.equal(isDueOn(every3, WED),                              true,  'day 3 (WED = Aug 5)')
  assert.equal(isDueOn(every3, new Date('2026-08-03T00:00:00')), false, 'day 1 — off cycle')
  assert.equal(isDueOn(every3, new Date('2026-08-04T00:00:00')), false, 'day 2 — off cycle')
  assert.equal(isDueOn(every3, new Date('2026-08-08T00:00:00')), true,  'day 6')
})

test('interval: every 1 day fires every day', () => {
  const daily = { ...base, cadence: 'interval', interval_days: 1, anchor_date: '2026-08-01' }
  assert.equal(isDueOn(daily, WED),  true)
  assert.equal(isDueOn(daily, MON),  true)
  assert.equal(isDueOn(daily, FRI),  true)
})

test('interval: not due before the anchor date', () => {
  const future = { ...base, cadence: 'interval', interval_days: 7, anchor_date: '2026-09-01' }
  assert.equal(isDueOn(future, WED), false) // WED is Aug 5 — before the anchor
})

test('interval: missing interval_days or anchor_date → not due', () => {
  assert.equal(isDueOn({ ...base, cadence: 'interval', interval_days: null,  anchor_date: '2026-08-01' }, WED), false)
  assert.equal(isDueOn({ ...base, cadence: 'interval', interval_days: 3,     anchor_date: null }, WED),          false)
  assert.equal(isDueOn({ ...base, cadence: 'interval', interval_days: 0,     anchor_date: '2026-08-01' }, WED), false)
})

test('unknown cadence returns false', () => {
  assert.equal(isDueOn({ ...base, cadence: 'fortnightly' as never }, WED), false)
})
