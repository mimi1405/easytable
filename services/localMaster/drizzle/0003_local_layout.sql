CREATE TABLE IF NOT EXISTS `layout_floors` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_layout_floors_location` ON `layout_floors` (`location_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_layout_floors_location_name` ON `layout_floors` (`location_id`,`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `layout_areas` (
	`id` text PRIMARY KEY NOT NULL,
	`floor_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`floor_id`) REFERENCES `layout_floors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_layout_areas_floor` ON `layout_areas` (`floor_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_layout_areas_floor_name` ON `layout_areas` (`floor_id`,`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `layout_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text NOT NULL,
	`name` text NOT NULL,
	`seats` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`area_id`) REFERENCES `layout_areas`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_layout_tables_area` ON `layout_tables` (`area_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_layout_tables_area_name` ON `layout_tables` (`area_id`,`name`);
