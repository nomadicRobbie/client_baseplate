// Validation engine — jurisdiction-agnostic. Evaluates a record type's
// `critical_limit` (seed data) against a submitted record's `data` and returns
// pass | fail | na. `na` means "no rule, or the rule's field wasn't supplied" —
// it never fabricates a fail for a missing optional measurement.

type Result = 'pass' | 'fail' | 'na'
type Rule = { field: string; op: string; value?: unknown }
type TimeTemp = { op: 'time_temp'; temp_field: string; time_field: string; value: [number, number][] }
type Limit = Rule | TimeTemp | { all: Rule[] } | { any: Rule[] } | null | undefined

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function evalRule(rule: Rule | TimeTemp, data: Record<string, unknown>): Result {
  if (rule.op === 'time_temp') {
    const r = rule as TimeTemp
    const t = data[r.temp_field], m = data[r.time_field]
    if (!isNum(t) || !isNum(m)) return 'na'
    return r.value.some(([ct, cm]) => t >= ct && m >= cm) ? 'pass' : 'fail'
  }
  const { field, op, value } = rule as Rule
  const v = data[field]
  if (op === 'is_true') return v === undefined ? 'na' : v === true ? 'pass' : 'fail'
  if (!isNum(v) || !isNum(value)) return 'na'
  switch (op) {
    case 'lte': return v <= value ? 'pass' : 'fail'
    case 'gte': return v >= value ? 'pass' : 'fail'
    case 'lt':  return v <  value ? 'pass' : 'fail'
    case 'gt':  return v >  value ? 'pass' : 'fail'
    case 'eq':  return v === value ? 'pass' : 'fail'
    default:    return 'na'
  }
}

// Combine sub-results: any fail → fail; else any pass → pass; else na.
function combine(results: Result[], mode: 'all' | 'any'): Result {
  if (mode === 'all') {
    if (results.includes('fail')) return 'fail'
    return results.includes('pass') ? 'pass' : 'na'
  }
  // any
  if (results.includes('pass')) return 'pass'
  return results.includes('fail') ? 'fail' : 'na'
}

export function evaluate(limit: Limit, data: Record<string, unknown>): Result {
  if (!limit) return 'na'
  if ('all' in limit) return combine(limit.all.map(r => evalRule(r, data)), 'all')
  if ('any' in limit) return combine(limit.any.map(r => evalRule(r, data)), 'any')
  return evalRule(limit as Rule | TimeTemp, data)
}

// ── Self-check: `tsx src/modules/compliance/engine.ts` ──────────────────────
function demo(): void {
  const eq = (got: Result, want: Result, msg: string) => {
    if (got !== want) throw new Error(`FAIL ${msg}: got ${got}, want ${want}`)
  }
  // fridge ≤ 5°C
  eq(evaluate({ field: 'temp_c', op: 'lte', value: 5 }, { temp_c: 4 }), 'pass', 'fridge cold')
  eq(evaluate({ field: 'temp_c', op: 'lte', value: 5 }, { temp_c: 8 }), 'fail', 'fridge warm')
  eq(evaluate({ field: 'temp_c', op: 'lte', value: 5 }, {}), 'na', 'fridge missing')
  // bool
  eq(evaluate({ field: 'frozen_solid', op: 'is_true' }, { frozen_solid: false }), 'fail', 'not frozen')
  eq(evaluate({ field: 'frozen_solid', op: 'is_true' }, { frozen_solid: undefined }), 'na', 'frozen unset')
  // time_temp — 70°C/3min valid combo
  const tt = { op: 'time_temp', temp_field: 'temp_c', time_field: 'minutes', value: [[65, 15], [70, 3], [75, 0.5]] } as TimeTemp
  eq(evaluate(tt, { temp_c: 72, minutes: 3 }), 'pass', 'cook 72/3')
  eq(evaluate(tt, { temp_c: 70, minutes: 1 }), 'fail', 'cook 70/1 too short')
  eq(evaluate(tt, { temp_c: 60, minutes: 20 }), 'fail', 'cook too cool')
  // all — receiving needs both bools
  const recv = { all: [{ field: 'use_by_ok', op: 'is_true' }, { field: 'packaging_ok', op: 'is_true' }] } as Limit
  eq(evaluate(recv, { use_by_ok: true, packaging_ok: true }), 'pass', 'recv ok')
  eq(evaluate(recv, { use_by_ok: true, packaging_ok: false }), 'fail', 'recv bad pkg')
  // any — transport cold OR hot
  const tr = { any: [{ field: 'temp_c', op: 'lte', value: 5 }, { field: 'temp_c', op: 'gt', value: 60 }] } as Limit
  eq(evaluate(tr, { temp_c: 3 }), 'pass', 'transport cold')
  eq(evaluate(tr, { temp_c: 65 }), 'pass', 'transport hot')
  eq(evaluate(tr, { temp_c: 30 }), 'fail', 'transport danger zone')
  // no rule
  eq(evaluate(null, { anything: 1 }), 'na', 'no limit')
  console.log('compliance engine: all checks passed')
}

if (require.main === module) demo()
