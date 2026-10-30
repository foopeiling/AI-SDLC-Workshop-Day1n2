export const PRIORITY_VALUES = ['high', 'medium', 'low'] as const;

export type Priority = (typeof PRIORITY_VALUES)[number];

export const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};