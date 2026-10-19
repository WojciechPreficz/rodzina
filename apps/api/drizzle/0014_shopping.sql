CREATE TABLE `shopping_history` (
	`family_id` text NOT NULL,
	`name_normalized` text NOT NULL,
	`display_name` text NOT NULL,
	`category` text NOT NULL,
	`use_count` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`family_id`, `name_normalized`),
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` text,
	`category` text DEFAULT 'other' NOT NULL,
	`is_checked` integer DEFAULT false NOT NULL,
	`checked_by` text,
	`checked_at` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_items_list_position_idx` ON `shopping_items` (`list_id`,`position`);--> statement-breakpoint
CREATE TABLE `shopping_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_lists_family_position_idx` ON `shopping_lists` (`family_id`,`position`);