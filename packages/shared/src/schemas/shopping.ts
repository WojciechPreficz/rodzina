import { z } from 'zod';

export const SHOPPING_CATEGORIES = [
  { value: 'fruit_vegetables', label: 'Warzywa i owoce' },
  { value: 'bakery', label: 'Pieczywo' },
  { value: 'dairy', label: 'Nabiał' },
  { value: 'meat_fish', label: 'Mięso i ryby' },
  { value: 'frozen', label: 'Mrożonki' },
  { value: 'dry_goods', label: 'Suche i sypkie' },
  { value: 'drinks', label: 'Napoje' },
  { value: 'household_hygiene', label: 'Chemia i higiena' },
  { value: 'children', label: 'Dla dzieci' },
  { value: 'other', label: 'Inne' },
] as const;

export const shoppingCategorySchema = z.enum([
  'fruit_vegetables',
  'bakery',
  'dairy',
  'meat_fish',
  'frozen',
  'dry_goods',
  'drinks',
  'household_hygiene',
  'children',
  'other',
]);
const nameSchema = z.string().trim().min(1).max(200);
const positionSchema = z.number().int().min(0).max(2147483647);
export const createShoppingListSchema = z.object({ name: nameSchema }).strict();
export const patchShoppingListSchema = z
  .object({
    name: nameSchema.optional(),
    position: positionSchema.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Brak danych do zmiany.');
export const createShoppingItemSchema = z
  .object({
    name: nameSchema,
    quantity: z.string().trim().max(100).nullable().optional(),
    category: shoppingCategorySchema.optional(),
  })
  .strict();
export const patchShoppingItemSchema = createShoppingItemSchema
  .partial()
  .extend({
    isChecked: z.boolean().optional(),
    position: positionSchema.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Brak danych do zmiany.');
export const shoppingSuggestionsQuerySchema = z.object({ q: nameSchema }).strict();

export const shoppingListSchema = z.object({
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  name: nameSchema,
  position: positionSchema,
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const shoppingItemSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  name: nameSchema,
  quantity: z.string().nullable(),
  category: shoppingCategorySchema,
  isChecked: z.boolean(),
  checkedBy: z.string().uuid().nullable(),
  checkedAt: z.number().int().nullable(),
  position: positionSchema,
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const shoppingSuggestionSchema = z.object({
  name: nameSchema,
  category: shoppingCategorySchema,
});
export const shoppingListsResponseSchema = z.object({ ok: z.literal(true), lists: z.array(shoppingListSchema) });
export const shoppingListResponseSchema = z.object({ ok: z.literal(true), list: shoppingListSchema });
export const shoppingItemsResponseSchema = z.object({ ok: z.literal(true), items: z.array(shoppingItemSchema) });
export const shoppingItemResponseSchema = z.object({ ok: z.literal(true), item: shoppingItemSchema });
export const shoppingSuggestionsResponseSchema = z.object({
  ok: z.literal(true),
  suggestions: z.array(shoppingSuggestionSchema).max(8),
});
export const shoppingDeletedResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });
export const shoppingClearedResponseSchema = z.object({
  ok: z.literal(true),
  deletedCount: z.number().int().nonnegative(),
});

export type ShoppingCategory = z.infer<typeof shoppingCategorySchema>;
export type ShoppingList = z.infer<typeof shoppingListSchema>;
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;
export type CreateShoppingList = z.infer<typeof createShoppingListSchema>;
export type PatchShoppingList = z.infer<typeof patchShoppingListSchema>;
export type CreateShoppingItem = z.infer<typeof createShoppingItemSchema>;
export type PatchShoppingItem = z.infer<typeof patchShoppingItemSchema>;
