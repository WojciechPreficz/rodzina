CREATE TABLE `task_occurrences` (
	`task_id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`series_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`planned_date` text NOT NULL,
	`planned_time` text,
	`state` text DEFAULT 'active' NOT NULL,
	`closed_at` integer,
	`closed_by` text,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`,`list_id`) REFERENCES `tasks`(`id`,`list_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`,`list_id`) REFERENCES `task_series`(`id`,`list_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_occurrences_sequence" CHECK("task_occurrences"."sequence" >= 0 AND "task_occurrences"."version" >= 0),
	CONSTRAINT "task_occurrences_closure" CHECK(("task_occurrences"."state" = 'active' AND "task_occurrences"."closed_at" IS NULL AND "task_occurrences"."closed_by" IS NULL) OR ("task_occurrences"."state" IN ('done', 'skipped') AND "task_occurrences"."closed_at" IS NOT NULL AND "task_occurrences"."closed_at" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_occurrences_sequence_idx` ON `task_occurrences` (`series_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_occurrences_active_idx` ON `task_occurrences` (`series_id`) WHERE "task_occurrences"."state" = 'active';--> statement-breakpoint
CREATE TABLE `task_series` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`rule` text NOT NULL,
	`template` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `task_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "task_series_state" CHECK("task_series"."state" IN ('active', 'stopped', 'ended')),
	CONSTRAINT "task_series_version" CHECK("task_series"."version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_series_id_list_idx` ON `task_series` (`id`,`list_id`);--> statement-breakpoint
CREATE INDEX `task_series_list_idx` ON `task_series` (`list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_id_list_idx` ON `tasks` (`id`,`list_id`);