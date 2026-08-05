import type { ComplianceFieldSpec } from '@blnk/shared';

// Advisory, client-side mirror of the backend validation engine — used only to
// show a live pass/fail hint and a plain-English limit as the user types. The
// BACKEND remains the source of truth: it recomputes the real result on save.
// Keep this in sync with apps/api/src/modules/compliance/engine.ts.

type Result = 'pass' | 'fail' | 'na';
type Rule = { field: string; op: string; value?: unknown };
type TimeTemp = { op: 'time_temp'; temp_field: string; time_field: string; value: [number, number][] };
type Limit = Rule | TimeTemp | { all: Rule[] } | { any: Rule[] } | null | undefined;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function evalRule(rule: Rule | TimeTemp, data: Record<string, unknown>): Result {
  if (rule.op === 'time_temp') {
    const r = rule as TimeTemp;
    const temp = data[r.temp_field], mins = data[r.time_field];
    if (!isNum(temp) || !isNum(mins)) return 'na';
    return r.value.some(([ct, cm]) => temp >= ct && mins >= cm) ? 'pass' : 'fail';
  }
  const { field, op, value } = rule as Rule;
  const v = data[field];
  if (op === 'is_true') return v === undefined ? 'na' : v === true ? 'pass' : 'fail';
  if (!isNum(v) || !isNum(value)) return 'na';
  switch (op) {
    case 'lte': return v <= value ? 'pass' : 'fail';
    case 'gte': return v >= value ? 'pass' : 'fail';
    case 'lt':  return v < value ? 'pass' : 'fail';
    case 'gt':  return v > value ? 'pass' : 'fail';
    case 'eq':  return v === value ? 'pass' : 'fail';
    default:    return 'na';
  }
}

function combine(results: Result[], mode: 'all' | 'any'): Result {
  if (mode === 'all') return results.includes('fail') ? 'fail' : results.includes('pass') ? 'pass' : 'na';
  return results.includes('pass') ? 'pass' : results.includes('fail') ? 'fail' : 'na';
}

export function evalLimit(limit: unknown, data: Record<string, unknown>): Result {
  const l = limit as Limit;
  if (!l) return 'na';
  if ('all' in l) return combine(l.all.map((r) => evalRule(r, data)), 'all');
  if ('any' in l) return combine(l.any.map((r) => evalRule(r, data)), 'any');
  return evalRule(l as Rule | TimeTemp, data);
}

// ── Plain-English limit for the hint box (e.g. "Must be ≤ 5 °C") ─────────────
const OP_TEXT: Record<string, string> = { lte: '≤', gte: '≥', lt: '<', gt: '>', eq: '=' };

function unitFor(field: string, schema: ComplianceFieldSpec[]): string {
  const f = schema.find((s) => s.key === field);
  return f?.unit ? ` ${f.unit}` : '';
}

function describeRule(rule: Rule, schema: ComplianceFieldSpec[]): string | null {
  if (rule.op === 'is_true') {
    const f = schema.find((s) => s.key === rule.field);
    return `${f?.label ?? rule.field} required`;
  }
  const sym = OP_TEXT[rule.op];
  if (!sym || typeof rule.value !== 'number') return null;
  return `${sym} ${rule.value}${unitFor(rule.field, schema)}`;
}

export function describeLimit(limit: unknown, schema: ComplianceFieldSpec[]): string | null {
  const l = limit as Limit;
  if (!l) return null;
  if ('op' in l && l.op === 'time_temp') {
    return 'Must reach ' + (l as TimeTemp).value.map(([c, m]) => `${c} °C/${m < 1 ? `${m * 60} s` : `${m} min`}`).join(' · ');
  }
  if ('all' in l) return l.all.map((r) => describeRule(r, schema)).filter(Boolean).join(' and ') || null;
  if ('any' in l) return l.any.map((r) => describeRule(r, schema)).filter(Boolean).join(' or ') || null;
  return describeRule(l as Rule, schema);
}
