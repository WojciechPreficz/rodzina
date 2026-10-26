CREATE TABLE `auth_rate_limits` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_rate_limits_expiry_idx` ON `auth_rate_limits` (`expires_at`);