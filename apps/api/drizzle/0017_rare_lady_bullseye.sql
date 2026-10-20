PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`event_id` text,
	`task_id` text,
	`document_id` text,
	`type` text NOT NULL,
	`offset_value` integer,
	`offset_unit` text,
	`remind_at` integer,
	`audience` text NOT NULL,
	`user_id` text,
	`created_by` text,
	`next_fire_at` integer,
	`last_sent_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reminders_one_source" CHECK(("__new_reminders"."event_id" IS NOT NULL) + ("__new_reminders"."task_id" IS NOT NULL) + ("__new_reminders"."document_id" IS NOT NULL) = 1),
	CONSTRAINT "reminders_personal_user" CHECK(("__new_reminders"."audience" = 'user' AND "__new_reminders"."user_id" IS NOT NULL) OR ("__new_reminders"."audience" <> 'user' AND "__new_reminders"."user_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_reminders`("id", "family_id", "event_id", "task_id", "document_id", "type", "offset_value", "offset_unit", "remind_at", "audience", "user_id", "created_by", "next_fire_at", "last_sent_at") SELECT "id", "family_id", "event_id", "task_id", "document_id", "type", "offset_value", "offset_unit", "remind_at", "audience", "user_id", "created_by", "next_fire_at", "last_sent_at" FROM `reminders`;--> statement-breakpoint
DROP TABLE `reminders`;--> statement-breakpoint
ALTER TABLE `__new_reminders` RENAME TO `reminders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reminders_event_idx` ON `reminders` (`family_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `reminders_next_fire_idx` ON `reminders` (`next_fire_at`);