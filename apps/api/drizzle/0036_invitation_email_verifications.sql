CREATE TABLE `invitation_email_verifications` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`invitation_id` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_email_verifications_invitation_idx` ON `invitation_email_verifications` (`invitation_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_verifications_expiry_idx` ON `invitation_email_verifications` (`expires_at`);