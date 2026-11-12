import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { families, users } from './family.js';
import { shoppingLists } from './shopping.js';

export const meals = sqliteTable(
  'meals',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    slot: text('slot').$type<'dinner'>().notNull().default('dinner'),
    title: text('title').notNull(),
    notes: text('notes'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('meals_family_date_idx').on(table.familyId, table.date),
    index('meals_family_updated_idx').on(table.familyId, table.updatedAt),
    index('meals_created_by_idx').on(table.createdBy),
    check('meals_dinner_slot', sql`${table.slot} = 'dinner'`),
  ],
);

export const mealIngredients = sqliteTable(
  'meal_ingredients',
  {
    id: text('id').primaryKey(),
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: text('quantity'),
    position: integer('position').notNull(),
  },
  (table) => [index('meal_ingredients_meal_position_idx').on(table.mealId, table.position)],
);

// Receipts only detect repeated manual exports; they never synchronize source changes.
export const mealShoppingExports = sqliteTable(
  'meal_shopping_exports',
  {
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.mealId, table.listId] })],
);
