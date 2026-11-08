CREATE TABLE `pending_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`family_name` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ready` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_registrations_token_hash_unique` ON `pending_registrations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `pending_registrations_email_idx` ON `pending_registrations` (`email`);--> statement-breakpoint
CREATE INDEX `pending_registrations_expiry_idx` ON `pending_registrations` (`expires_at`);