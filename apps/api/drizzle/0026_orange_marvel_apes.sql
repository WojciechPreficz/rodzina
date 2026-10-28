CREATE TABLE `meal_shopping_exports` (
	`meal_id` text NOT NULL,
	`list_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`meal_id`, `list_id`),
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
