CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`password_hash` text,
	`pin_hash` text,
	`role` text NOT NULL DEFAULT 'member',
	`color` text NOT NULL DEFAULT '#5C7CFA',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON DELETE cascade
);
