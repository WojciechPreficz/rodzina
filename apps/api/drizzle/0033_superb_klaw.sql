DROP INDEX `meals_family_date_slot_idx`;--> statement-breakpoint
CREATE INDEX `meals_family_date_idx` ON `meals` (`family_id`,`date`);