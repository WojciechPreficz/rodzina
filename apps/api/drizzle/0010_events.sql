CREATE TABLE `event_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`original_date` text NOT NULL,
	`is_cancelled` integer DEFAULT false NOT NULL,
	`override_start_date` text,
	`override_start_time` text,
	`override_duration_minutes` integer,
	`override_title` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_exceptions_event_date_idx` ON `event_exceptions` (`event_id`,`original_date`);--> statement-breakpoint
CREATE TABLE `event_participants` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`start_date` text NOT NULL,
	`start_time` text,
	`duration_minutes` integer,
	`date_precision` text NOT NULL,
	`rrule` text,
	`kind` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `events_family_date_idx` ON `events` (`family_id`,`start_date`);