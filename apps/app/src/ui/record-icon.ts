import type { Ionicons } from '@expo/vector-icons';

// Outline icon for a compliance record type. Single-colour, stroke-style
// (Ionicons `-outline`) to match the app's nav convention; colour is applied
// by the caller from the theme (usually t.color.primary), so it re-skins with
// the client's brand colour automatically.

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Code-specific overrides take priority over the category fallback.
const BY_CODE: Record<string, IoniconName> = {
  business_profile: 'business-outline',
  staff_training: 'school-outline',
  staff_sickness: 'medkit-outline',
  fridge_temp: 'thermometer-outline',
  freezer_check: 'snow-outline',
  cooking_poultry_mince_liver: 'flame-outline',
  cooking_general: 'flame-outline',
  cooling: 'snow-outline',
  reheating: 'flame-outline',
  hot_holding: 'flame-outline',
  receiving: 'cube-outline',
  supply_to_business: 'business-outline',
  cleaning_close: 'sparkles-outline',
  maintenance_calibration: 'construct-outline',
  labelling: 'pricetag-outline',
  transport: 'car-outline',
  display_selfservice: 'storefront-outline',
  self_supply_water: 'water-outline',
  corrective_action: 'warning-outline',
  recall: 'megaphone-outline',
  self_verification_check: 'checkmark-done-outline',
};

const BY_CATEGORY: Record<string, IoniconName> = {
  setup: 'clipboard-outline',
  people: 'people-outline',
  temperature: 'thermometer-outline',
  cooking: 'flame-outline',
  cooling: 'snow-outline',
  receiving: 'cube-outline',
  traceability: 'git-network-outline',
  cleaning: 'sparkles-outline',
  maintenance: 'construct-outline',
  labelling: 'pricetag-outline',
  transport: 'car-outline',
  display: 'storefront-outline',
  water: 'water-outline',
  incident: 'warning-outline',
  verification: 'checkmark-done-outline',
};

export function recordIcon(code: string, category?: string | null): IoniconName {
  return BY_CODE[code] ?? (category ? BY_CATEGORY[category] : undefined) ?? 'ellipse-outline';
}
