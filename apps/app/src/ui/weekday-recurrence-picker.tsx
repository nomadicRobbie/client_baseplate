import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text } from './components';
import { DateField } from './date-field';
import { TimeField } from './time-field';

export type RecurrenceValue = {
  days: number[];        // 0=Sun..6=Sat; empty = one-off
  time: string;          // HH:MM
  startDate: string;     // YYYY-MM-DD
  endDate: string | null; // null = indefinite
};

type Props = {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
  errors?: Record<string, string>;
};

// Mon-first display order; stored values stay 0=Sun..6=Sat
const PILLS = [
  { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 }, { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

export function WeekdayRecurrencePicker({ value, onChange, errors = {} }: Props) {
  const t = useTheme();

  const toggleDay = (d: number) => {
    const next = value.days.includes(d) ? value.days.filter(x => x !== d) : [...value.days, d];
    onChange({ ...value, days: next.sort((a, b) => a - b) });
  };

  const isRecurring = value.days.length > 0;
  const isIndefinite = value.endDate === null;

  return (
    <View style={{ gap: 16 }}>
      {/* Day pills */}
      <View style={{ gap: 6 }}>
        <Text variant="label" muted>Repeat on</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PILLS.map(p => {
            const sel = value.days.includes(p.value);
            return (
              <Pressable
                key={p.value}
                onPress={() => toggleDay(p.value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sel }}
                style={{
                  paddingVertical: 6, paddingHorizontal: 12,
                  borderRadius: 999, borderWidth: 1,
                  borderColor: sel ? t.color.primary : t.color.border,
                  backgroundColor: sel ? t.color.primary : 'transparent',
                }}
              >
                <Text variant="small" color={sel ? t.color.bg : t.color.text}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {errors.days ? <Text variant="small" color={t.color.danger}>{errors.days}</Text> : null}
      </View>

      {/* Time — only when repeating */}
      {isRecurring && (
        <TimeField
          label="Start time"
          value={value.time}
          onChange={time => onChange({ ...value, time })}
        />
      )}

      {/* Start date */}
      <DateField
        label={isRecurring ? 'Starting from' : 'Date'}
        value={value.startDate}
        onChange={startDate => onChange({ ...value, startDate })}
      />
      {errors.startDate ? <Text variant="small" color={t.color.danger}>{errors.startDate}</Text> : null}

      {/* Indefinite toggle + end date — only when repeating */}
      {isRecurring && (
        <View style={{ gap: 10 }}>
          <Pressable
            onPress={() => onChange({ ...value, endDate: isIndefinite ? '' : null })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isIndefinite }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Ionicons
              name={isIndefinite ? 'checkbox' : 'square-outline'}
              size={20}
              color={isIndefinite ? t.color.primary : t.color.textMuted}
            />
            <Text variant="label">Repeat indefinitely</Text>
          </Pressable>

          {!isIndefinite && (
            <>
              <DateField
                label="Until"
                value={value.endDate ?? ''}
                onChange={endDate => onChange({ ...value, endDate: endDate || null })}
              />
              {errors.endDate ? <Text variant="small" color={t.color.danger}>{errors.endDate}</Text> : null}
            </>
          )}
        </View>
      )}
    </View>
  );
}
