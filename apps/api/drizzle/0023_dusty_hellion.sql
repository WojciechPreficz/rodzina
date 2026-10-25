CREATE TABLE `contact_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_groups_id_family_idx` ON `contact_groups` (`id`,`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_groups_default_idx` ON `contact_groups` (`family_id`) WHERE "contact_groups"."is_default" = 1;--> statement-breakpoint
CREATE INDEX `contact_groups_family_idx` ON `contact_groups` (`family_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`phone` text,
	`relationship` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`,`family_id`) REFERENCES `contact_groups`(`id`,`family_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_family_group_idx` ON `contacts` (`family_id`,`group_id`);
--> statement-breakpoint
INSERT INTO contact_groups (id, family_id, name, is_default, created_by, created_at, updated_at)
SELECT random_uuid(), families.id, initial.name, initial.is_default,
  (SELECT users.id FROM users WHERE users.family_id = families.id AND users.role = 'admin' ORDER BY users.created_at, users.id LIMIT 1),
  CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM families CROSS JOIN (
  SELECT 'Rodzina' AS name, 0 AS is_default UNION ALL SELECT 'Znajomi', 0
  UNION ALL SELECT 'Praca', 0 UNION ALL SELECT 'Inne', 1
) AS initial;
