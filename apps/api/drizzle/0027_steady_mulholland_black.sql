CREATE TABLE `task_checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	`done_by` text,
	`done_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`done_version` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `task_checklist_task_position_idx` ON `task_checklist_items` (`task_id`,`position`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `checklist_order_version` integer DEFAULT 0 NOT NULL;