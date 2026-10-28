CREATE TABLE `meal_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meal_ingredients_meal_position_idx` ON `meal_ingredients` (`meal_id`,`position`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text DEFAULT 'dinner' NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meals_dinner_slot" CHECK("meals"."slot" = 'dinner')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meals_family_date_slot_idx` ON `meals` (`family_id`,`date`,`slot`);--> statement-breakpoint
CREATE INDEX `meals_family_updated_idx` ON `meals` (`family_id`,`updated_at`);