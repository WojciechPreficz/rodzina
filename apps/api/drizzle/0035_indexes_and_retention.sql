ALTER TABLE `event_import_operations` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Older imports have no recorded timestamp. Keep them for a full retention window after the upgrade.
UPDATE `event_import_operations` SET `created_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER);--> statement-breakpoint
CREATE INDEX `event_import_operations_created_at_idx` ON `event_import_operations` (`created_at`);--> statement-breakpoint
CREATE INDEX `contact_groups_created_by_idx` ON `contact_groups` (`created_by`);--> statement-breakpoint
CREATE INDEX `contacts_created_by_idx` ON `contacts` (`created_by`);--> statement-breakpoint
CREATE INDEX `documents_created_by_idx` ON `documents` (`created_by`);--> statement-breakpoint
CREATE INDEX `events_created_by_idx` ON `events` (`created_by`);--> statement-breakpoint
CREATE INDEX `invitations_expiry_idx` ON `invitations` (`expires_at`);--> statement-breakpoint
CREATE INDEX `invitations_created_by_idx` ON `invitations` (`created_by`);--> statement-breakpoint
CREATE INDEX `meals_created_by_idx` ON `meals` (`created_by`);--> statement-breakpoint
CREATE INDEX `password_resets_expiry_idx` ON `password_resets` (`expires_at`);--> statement-breakpoint
CREATE INDEX `reminders_task_idx` ON `reminders` (`task_id`,`family_id`);--> statement-breakpoint
CREATE INDEX `reminders_created_by_idx` ON `reminders` (`created_by`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `shopping_items_created_by_idx` ON `shopping_items` (`created_by`);--> statement-breakpoint
CREATE INDEX `shopping_lists_created_by_idx` ON `shopping_lists` (`created_by`);--> statement-breakpoint
CREATE INDEX `task_checklist_items_created_by_idx` ON `task_checklist_items` (`created_by`);--> statement-breakpoint
CREATE INDEX `task_series_created_by_idx` ON `task_series` (`created_by`);--> statement-breakpoint
CREATE INDEX `tasks_created_by_idx` ON `tasks` (`created_by`);--> statement-breakpoint
CREATE INDEX `users_family_idx` ON `users` (`family_id`);
