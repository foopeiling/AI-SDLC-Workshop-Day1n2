import type { TemplateSubtask } from './db';
import { formatSingaporeIsoDateTime } from './timezone';

export const MAX_TEMPLATE_OFFSET_MINUTES = 5_256_000;

export function parseTemplateSubtasks(value: string | null): TemplateSubtask[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is { title: string; position: number } =>
        typeof item === 'object' && item !== null &&
        typeof item.title === 'string' && item.title.trim().length > 0 &&
        Number.isSafeInteger(item.position) && item.position >= 0,
      )
      .map((item) => ({ title: item.title.trim(), position: item.position }))
      .sort((first, second) => first.position - second.position);
  } catch {
    return [];
  }
}

export function calculateTemplateDueDate(offsetMinutes: number | null, now: Date): string | null {
  if (offsetMinutes === null) return null;
  if (
    !Number.isSafeInteger(offsetMinutes) ||
    offsetMinutes < 1 ||
    offsetMinutes > MAX_TEMPLATE_OFFSET_MINUTES
  ) {
    throw new Error('Template due date offset is outside the supported range.');
  }

  const dueDate = new Date(now.getTime() + offsetMinutes * 60_000);
  if (Number.isNaN(dueDate.getTime())) {
    throw new Error('Template due date is invalid.');
  }
  return formatSingaporeIsoDateTime(dueDate);
}