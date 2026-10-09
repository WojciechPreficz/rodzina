CREATE TABLE `families` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL DEFAULT 'Europe/Warsaw',
	`join_code` text NOT NULL,
	`created_at` integer NOT NULL
);
