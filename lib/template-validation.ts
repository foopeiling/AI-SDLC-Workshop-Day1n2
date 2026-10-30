import { z } from 'zod';
import { MAX_TEMPLATE_OFFSET_MINUTES } from './template-utils';

const templateFields = {
  name: z.string().trim().min(1, 'Template name is required').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  title_template: z.string().trim().min(1, 'Template title is required').max(500),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  is_recurring: z.boolean().default(false),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  reminder_minutes: z.union([
    z.literal(15), z.literal(30), z.literal(60), z.literal(120),
    z.literal(1440), z.literal(2880), z.literal(10080),
  ]).nullable().optional(),
  due_date_offset_minutes: z.number().int().min(1).max(MAX_TEMPLATE_OFFSET_MINUTES).nullable().optional(),
  subtasks: z.array(z.object({
    title: z.string().trim().min(1, 'Subtask titles cannot be empty').max(500),
    position: z.number().int().min(0),
  })).max(500).optional(),
};

function validateSchedule(
  value: {
    is_recurring: boolean;
    recurrence_pattern?: string | null;
    reminder_minutes?: number | null;
    due_date_offset_minutes?: number | null;
  },
  context: z.RefinementCtx,
): void {
  if (value.is_recurring && !value.recurrence_pattern) {
    context.addIssue({
      code: 'custom',
      path: ['recurrence_pattern'],
      message: 'A repeat pattern is required for recurring templates.',
    });
  }

  if (
    (value.is_recurring || value.reminder_minutes != null) &&
    value.due_date_offset_minutes == null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['due_date_offset_minutes'],
      message: 'Recurring templates and reminders require a due date offset.',
    });
  }
}

export const createTemplateSchema = z.object(templateFields).strict().superRefine(validateSchedule);
export const updateTemplateSchema = z.object({
  ...templateFields,
  name: templateFields.name.optional(),
  title_template: templateFields.title_template.optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  is_recurring: z.boolean().optional(),
}).strict();

export function validateTemplateSchedule(value: z.infer<typeof createTemplateSchema>): string | null {
  const parsed = createTemplateSchema.safeParse(value);
  return parsed.success ? null : parsed.error.issues[0]?.message ?? 'Invalid template settings.';
}