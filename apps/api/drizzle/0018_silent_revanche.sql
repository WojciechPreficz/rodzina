CREATE TABLE `task_operations` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`list_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`response` text NOT NULL,
	`status` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `task_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
