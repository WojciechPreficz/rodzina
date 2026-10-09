CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade
);
