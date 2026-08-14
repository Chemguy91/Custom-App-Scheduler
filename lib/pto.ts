// Shared / demo / test accounts that should never show up as PTO assignees —
// in the "who is this PTO for" pickers, in the admin's all-PTO list, or as
// calendar badges. Matched case-insensitively against profiles.full_name.
export const PTO_HIDDEN_NAMES = [
  'Chem App TV',
  'Dan',
  'Demo',
  'Demo Account',
  'Jon',
  'Kelley',
  'Office TV',
  'Zak',
  'Clay',
]

export function isPtoHiddenName(fullName: string | null | undefined): boolean {
  if (!fullName) return false
  const trimmed = fullName.trim().toLowerCase()
  return PTO_HIDDEN_NAMES.some(n => n.toLowerCase() === trimmed)
}
