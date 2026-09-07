import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate } from '../src/modules/compliance/engine'

// Pure unit tests — no DB, no network.

test('lte: at limit passes, above fails, missing field is na', () => {
  const rule = { field: 'temp_c', op: 'lte', value: 5 }
  assert.equal(evaluate(rule, { temp_c: 5 }),  'pass')
  assert.equal(evaluate(rule, { temp_c: 4 }),  'pass')
  assert.equal(evaluate(rule, { temp_c: 6 }),  'fail')
  assert.equal(evaluate(rule, {}),             'na')
})

test('gte: at limit passes, below fails', () => {
  const rule = { field: 'temp_c', op: 'gte', value: 75 }
  assert.equal(evaluate(rule, { temp_c: 75 }), 'pass')
  assert.equal(evaluate(rule, { temp_c: 80 }), 'pass')
  assert.equal(evaluate(rule, { temp_c: 74 }), 'fail')
})

test('lt/gt: strict inequality', () => {
  assert.equal(evaluate({ field: 'x', op: 'lt', value: 5 }, { x: 4 }), 'pass')
  assert.equal(evaluate({ field: 'x', op: 'lt', value: 5 }, { x: 5 }), 'fail')
  assert.equal(evaluate({ field: 'x', op: 'gt', value: 5 }, { x: 6 }), 'pass')
  assert.equal(evaluate({ field: 'x', op: 'gt', value: 5 }, { x: 5 }), 'fail')
})

test('eq: exact match only', () => {
  assert.equal(evaluate({ field: 'x', op: 'eq', value: 7 }, { x: 7 }),   'pass')
  assert.equal(evaluate({ field: 'x', op: 'eq', value: 7 }, { x: 7.1 }), 'fail')
})

test('is_true: true passes, false fails, undefined is na', () => {
  assert.equal(evaluate({ field: 'ok', op: 'is_true' }, { ok: true }),      'pass')
  assert.equal(evaluate({ field: 'ok', op: 'is_true' }, { ok: false }),     'fail')
  assert.equal(evaluate({ field: 'ok', op: 'is_true' }, {}),               'na')
  assert.equal(evaluate({ field: 'ok', op: 'is_true' }, { ok: undefined }), 'na')
})

test('unknown op returns na', () => {
  assert.equal(evaluate({ field: 'x', op: 'xyzzy' as never, value: 1 }, { x: 1 }), 'na')
})

test('non-numeric value with numeric op returns na', () => {
  assert.equal(evaluate({ field: 'x', op: 'lte', value: 5 }, { x: 'cold' }), 'na')
  assert.equal(evaluate({ field: 'x', op: 'lte', value: 5 }, { x: NaN }),    'na')
  assert.equal(evaluate({ field: 'x', op: 'lte', value: 5 }, { x: Infinity }), 'na')
})

test('time_temp: valid combos pass, invalid fail, missing fields are na', () => {
  const rule = {
    op: 'time_temp',
    temp_field: 'temp_c',
    time_field: 'minutes',
    value: [[65, 15], [70, 3], [75, 0.5]] as [number, number][],
  }
  assert.equal(evaluate(rule as never, { temp_c: 70, minutes: 3 }),  'pass') // exact match
  assert.equal(evaluate(rule as never, { temp_c: 72, minutes: 5 }),  'pass') // above both thresholds
  assert.equal(evaluate(rule as never, { temp_c: 75, minutes: 0.5 }),'pass') // 75°C / 30s
  assert.equal(evaluate(rule as never, { temp_c: 70, minutes: 1 }),  'fail') // temp ok, time short
  assert.equal(evaluate(rule as never, { temp_c: 60, minutes: 30 }), 'fail') // time ok, temp too low
  assert.equal(evaluate(rule as never, {}),                           'na')   // both missing
  assert.equal(evaluate(rule as never, { temp_c: 70 }),               'na')   // time missing
})

test('all combinator: any fail → fail, all na → na, any pass + rest na → pass', () => {
  const rule = {
    all: [
      { field: 'a', op: 'is_true' },
      { field: 'b', op: 'is_true' },
    ],
  }
  assert.equal(evaluate(rule, { a: true,  b: true  }), 'pass')
  assert.equal(evaluate(rule, { a: true,  b: false }), 'fail')
  assert.equal(evaluate(rule, { a: false, b: true  }), 'fail')
  assert.equal(evaluate(rule, {}),                     'na')   // both missing
  assert.equal(evaluate(rule, { a: true }),            'pass') // one pass, one na → pass (no fail)
})

test('any combinator: any pass → pass, any fail (no pass) → fail, all na → na', () => {
  const rule = {
    any: [
      { field: 'temp_c', op: 'lte', value: 5  },
      { field: 'temp_c', op: 'gte', value: 60 },
    ],
  }
  assert.equal(evaluate(rule, { temp_c: 3  }), 'pass') // cold pass
  assert.equal(evaluate(rule, { temp_c: 65 }), 'pass') // hot pass
  assert.equal(evaluate(rule, { temp_c: 30 }), 'fail') // danger zone
  assert.equal(evaluate(rule, {}),             'na')   // no data
})

test('null/undefined limit returns na', () => {
  assert.equal(evaluate(null, { x: 1 }),      'na')
  assert.equal(evaluate(undefined, { x: 1 }), 'na')
})
