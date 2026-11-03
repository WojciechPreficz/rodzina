CREATE TABLE `event_import_operations` (
	`family_id` text NOT NULL,
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`event_id` text NOT NULL,
	PRIMARY KEY(`family_id`, `user_id`, `id`),
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_import_operations_user_idx` ON `event_import_operations` (`user_id`);