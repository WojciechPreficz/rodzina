ALTER TABLE `shopping_operations` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `shopping_operations_created_at_idx` ON `shopping_operations` (`created_at`);--> statement-breakpoint
ALTER TABLE `task_operations` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `task_operations_created_at_idx` ON `task_operations` (`created_at`);
--> statement-breakpoint
UPDATE shopping_operations SET created_at = unixepoch() * 1000 WHERE created_at = 0;
--> statement-breakpoint
UPDATE task_operations SET created_at = unixepoch() * 1000 WHERE created_at = 0;
