CREATE TABLE `task_series_history` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`task_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`planned_date` text NOT NULL,
	`planned_time` text,
	`state` text NOT NULL,
	`closed_at` integer NOT NULL,
	`closed_by` text,
	`series_version` integer NOT NULL,
	`successor_id` text,
	`successor_fingerprint` text,
	`undone_at` integer,
	`undone_by` text,
	FOREIGN KEY (`series_id`) REFERENCES `task_series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`undone_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "task_series_history_state" CHECK("task_series_history"."state" IN ('done', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `task_series_history_series_idx` ON `task_series_history` (`series_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_series_history_closure_idx` ON `task_series_history` (`series_id`,`sequence`) WHERE "task_series_history"."undone_at" IS NULL;