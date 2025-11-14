import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 2. Users Table (Public data for Pages 1 & 2 & 3)
export const users = pgTable('users', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// 2. Secret Messages Table (Public data for Pages 2 & 3)
export const secretMessages =  pgTable('secret_messages', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content'),
  updated_at: timestamp('updated_at', { withTimezone: true }).default(sql`current_timestamp`).notNull(),
});

// 3. Friend Requests Table (Public data for managing relationships)
export const friendRequests =  pgTable('friend_requests', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),

  sender_id: uuid('sender_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
    
  receiver_id: uuid('receiver_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  
  // Status can be 'pending' or 'accepted'
  status: varchar('status', { length: 16 }).notNull().default('pending'),

  created_at: timestamp('created_at', { withTimezone: true }).default(sql`current_timestamp`).notNull(),
}, (table) => {
  return {
    // Prevents duplicate requests (e.g., A sending a request to B twice)
    uniquePair: uniqueIndex('friend_requests_unique_pair_idx').on(table.sender_id, table.receiver_id),
  };
});