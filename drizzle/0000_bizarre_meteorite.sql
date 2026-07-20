CREATE TABLE `profiles` (
	`user_email` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`share_token` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trips_share_token_unique` ON `trips` (`share_token`);--> statement-breakpoint
CREATE INDEX `trips_user_email_idx` ON `trips` (`user_email`);--> statement-breakpoint
CREATE INDEX `trips_share_token_idx` ON `trips` (`share_token`);