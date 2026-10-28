import { z } from 'zod';
import { calendarDateSchema } from './events.js';
import { shoppingItemSchema } from './shopping.js';
import { normalizeShoppingName } from '../shopping.js';

// Leave room for every date of the requested week inside the supported calendar.
export const mealWeekStartSchema = calendarDateSchema.refine(
  (value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1 && value <= '9999-12-25',
  'Początek tygodnia musi być poniedziałkiem.',
);
export const mealParamsSchema = z.object({ date: calendarDateSchema, slot: z.literal('dinner') }).strict();
export const mealWeekQuerySchema = z.object({ weekStart: mealWeekStartSchema }).strict();
export const mealIngredientInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    quantity: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
export const putMealSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(5000).nullable().optional(),
    ingredients: z.array(mealIngredientInputSchema).max(100),
  })
  .strict();
export const copyMealWeekSchema = z
  .object({
    fromWeekStart: mealWeekStartSchema,
    toWeekStart: mealWeekStartSchema,
    overwrite: z.boolean(),
  })
  .strict()
  .refine((value) => value.fromWeekStart !== value.toWeekStart, 'Wybierz inny tydzień docelowy.');
export const mealSuggestionsQuerySchema = z.object({ q: z.string().trim().max(200).default('') }).strict();
export const mealSchema = putMealSchema.extend({
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  date: calendarDateSchema,
  slot: z.literal('dinner'),
  notes: z.string().nullable(),
  ingredients: z.array(z.object({ name: z.string(), quantity: z.string().nullable() })),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const mealResponseSchema = z.object({ ok: z.literal(true), meal: mealSchema });
export const mealWeekResponseSchema = z.object({
  ok: z.literal(true),
  weekStart: mealWeekStartSchema,
  days: z.array(z.object({ date: calendarDateSchema, meals: z.array(mealSchema) })).length(7),
});
export const mealSuggestionsResponseSchema = z.object({
  ok: z.literal(true),
  suggestions: z.array(mealSchema.pick({ title: true, ingredients: true })),
});
export const copyMealWeekResponseSchema = z.object({ ok: z.literal(true), copied: z.number().int().nonnegative() });
export const mealsToShoppingListSchema = z
  .object({
    weekStart: mealWeekStartSchema,
    listId: z.string().uuid(),
    mealIds: z.array(z.string().uuid()).min(1).max(7).optional(),
    confirmRepeat: z.boolean().default(false),
    snapshot: z
      .array(
        z
          .object({
            mealId: z.string().uuid(),
            date: calendarDateSchema,
            ingredients: z.array(mealIngredientInputSchema).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(7)
      .optional(),
    targets: z
      .array(z.object({ name: z.string().trim().min(1).max(200), id: z.string().uuid() }).strict())
      .max(700)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.snapshot?.map((meal) => meal.mealId);
    if (
      ids &&
      (new Set(ids).size !== ids.length ||
        (value.mealIds &&
          (new Set(value.mealIds).size !== ids.length || value.mealIds.some((id) => !ids.includes(id)))))
    )
      context.addIssue({ code: 'custom', message: 'Kopia składników musi odpowiadać wybranym obiadom.' });
    const names = value.targets?.map((target) => normalizeShoppingName(target.name));
    if (
      names &&
      (new Set(names).size !== names.length || new Set(value.targets!.map((target) => target.id)).size !== names.length)
    )
      context.addIssue({ code: 'custom', message: 'Identyfikatory i nazwy składników muszą być unikalne.' });
  });
export const mealsToShoppingListResponseSchema = z.object({
  ok: z.literal(true),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  items: z.array(shoppingItemSchema).optional(),
  aliases: z.record(z.string(), z.string()).optional(),
});
export type MealsToShoppingList = z.infer<typeof mealsToShoppingListSchema>;
export type PutMeal = z.infer<typeof putMealSchema>;
export type Meal = z.infer<typeof mealSchema>;
export type CopyMealWeek = z.infer<typeof copyMealWeekSchema>;

// Offline copies carry frozen writes, rather than reading a mutable source at replay time.
export const mealOfflineWriteSchema = z
  .object({
    date: calendarDateSchema,
    id: z.string().uuid(),
    expectedId: z.string().uuid().nullable(),
    data: putMealSchema.nullable(),
  })
  .strict();
export const mealOfflineChangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('write'),
      weekStart: mealWeekStartSchema,
      writes: z
        .array(mealOfflineWriteSchema)
        .max(7)
        .refine(
          (writes) =>
            new Set(writes.map((write) => write.date)).size === writes.length &&
            new Set(writes.map((write) => write.id)).size === writes.length,
          'Daty i identyfikatory zapisów nie mogą się powtarzać.',
        ),
    })
    .strict(),
  z.object({ type: z.literal('export'), data: mealsToShoppingListSchema }).strict(),
]);
export type MealOfflineChange = z.infer<typeof mealOfflineChangeSchema>;
