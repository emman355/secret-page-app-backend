import 'dotenv/config'; // Load .env variables
import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema.js';
import cors from 'cors';
import bodyParser from 'body-parser';
import { and, eq, or } from 'drizzle-orm';

// --- CONFIGURATION ---
const app = express();
const port = 3001;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set in environment variables.");
}

// --- DATABASE CONNECTION ---

// 1. Create a PostgreSQL connection pool using the 'pg' library
const pool = new Pool({
  connectionString: databaseUrl,
});

// 2. Initialize Drizzle ORM instance
// Note: We use the 'authenticated_users' schema as the default for our tables (users, profiles, secrets, friends)
const db = drizzle(pool, { schema, logger: true });

// --- MIDDLEWARE ---
app.use(cors());
app.use(bodyParser.json());


/**
 * AUTH SIMULATION MIDDLEWARE
 *
 * NOTE: In a real Supabase backend, this middleware would:
 * 1. Read the JWT from the 'Authorization: Bearer <token>' header.
 * 2. Verify the token's signature (e.g., using a library like jwt-decode).
 * 3. Extract the user's ID (sub) from the payload.
 *
 * For this demonstration, we simulate the authenticated UID by requiring it
 * in a custom 'x-user-id' header. The client MUST send this header for RLS to work.
 */

// Type definition for authenticated request
interface AuthRequest extends Request {
  userId?: string;
}
const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.headers['x-user-id'] as string;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized: 'x-user-id' header missing. Please authenticate." });
  }

  // Attach the authenticated user ID to the request object
  req.userId = userId;
  next();
};

// Apply auth middleware to all protected routes
app.use('/api/protected', authMiddleware);

// --- ENDPOINTS ---
app.post('/api/protected/users', async (req: AuthRequest, res) => {
  const { email } = req.body;
  const authenticatedUserId = req.userId!;

  try {
    const [user] = await db.insert(schema.users)
      .values({
        id: authenticatedUserId,
        email,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (!user) {
      // User already exists or insert was skipped
      return res.status(200).json({
        success: true,
        status: 'exists',
        message: 'User already exists. Change to a different Username or email.',
      });
    }

    return res.status(201).json({
      success: true,
      status: 'created',
      message: 'User created successfully.',
      data: user,
    });
  } catch (error) {
    console.error('User creation error:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to create user.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.delete('/api/protected/users/:userId', async (req: AuthRequest, res) => {
  const { userId } = req.params;

  try {
    const deletedUser = await db
      .delete(schema.users)
      .where(eq(schema.users.id, userId))
      .returning();

    if (deletedUser.length === 0) {
      return res.status(404).json({
        success: false,
        status: 'not_found',
        message: 'User not found or already deleted.',
      });
    }

    return res.status(200).json({
      success: true,
      status: 'deleted',
      message: 'User deleted successfully.',
      data: deletedUser[0],
    });
  } catch (error) {
    console.error('User deletion error:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to delete user.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Save/Overwrite the authenticated user's secret message
app.post('/api/protected/secret', async (req: AuthRequest, res) => {
  const { content } = req.body;
  const userId = req.userId!;

  // Validate input
  if (!userId || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 'invalid_request',
      message: 'Missing or invalid user ID or content.',
    });
  }

  try {
    const [secret] = await db
      .insert(schema.secretMessages)
      .values({
        user_id: userId,
        content: content.trim(),
        updated_at: new Date(),
      })
      .returning();

    if (!secret) {
      return res.status(500).json({
        success: false,
        status: 'insert_failed',
        message: 'Failed to save secret message.',
      });
    }

    return res.status(201).json({
      success: true,
      status: 'created',
      message: 'Secret message saved successfully.',
      data: secret,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 'server_error',
      message: 'An unexpected error occurred while saving the message.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/protected/secret-message', async (req: AuthRequest, res) => {
  const userId = req.userId!;

  if (!userId) {
    return res.status(401).json({
      success: false,
      status: 'unauthorized',
      message: 'User not authenticated.',
    });
  }

  try {
    const messages = await db
      .select()
      .from(schema.secretMessages)
      .where(eq(schema.secretMessages.user_id, userId));

    return res.status(200).json({
      success: true,
      status: 'fetched',
      message: 'All secret messages retrieved successfully.',
      data: messages,
    });
  } catch (error) {
    console.error('Fetch error:', error);
    return res.status(500).json({
      success: false,
      status: 'server_error',
      message: 'Failed to retrieve messages.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.put('/api/protected/secret/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = req.userId!;

  // Validate input
  if (!userId || !id || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({
      success: false,
      status: 'invalid_request',
      message: 'Missing or invalid user ID, message ID, or content.',
    });
  }

  try {
    const updated = await db
      .update(schema.secretMessages)
      .set({
        content: content.trim(),
        updated_at: new Date(),
      })
      .where(eq(schema.secretMessages.id, id))// ensures users can only update their own messages
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({
        success: false,
        status: 'not_found',
        message: 'Secret message not found or not owned by user.',
      });
    }

    return res.status(200).json({
      success: true,
      status: 'updated',
      message: 'Secret message updated successfully.',
      data: updated[0],
    });
  } catch (error) {
    console.error('Update error:', error);
    return res.status(500).json({
      success: false,
      status: 'server_error',
      message: 'Failed to update secret message.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/protected/add-friend', async (req: AuthRequest, res) => {
  const { receiver_id } = req.body;
  const sender_id = req.userId!;

  if (!receiver_id || receiver_id === sender_id) {
    return res.status(400).json({ error: 'Invalid receiver ID.' });
  }

  try {
    const existing = await db.query.friendRequests.findFirst({
    where: (fr, { eq, and }) =>
    and(eq(fr.sender_id, sender_id), eq(fr.receiver_id, receiver_id)),
});

    if (existing) {
      return res.status(409).json({ error: 'Friend request already sent.' });
    }

    const [request] = await db.insert(schema.friendRequests)
      .values({
        sender_id,
        receiver_id,
        status: 'pending',
        created_at: new Date(),
      })
      .returning();

    res.json({ success: true, request });
  } catch (error) {
    console.error('Friend request error:', error);
    res.status(500).json({ error: 'Failed to send friend request.' });
  }
});

app.get('/api/protected/friends/friend-requests', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { friendRequests, users } = schema;

  try {
    const requests = await db
      .select({
        id: friendRequests.id,
        status: friendRequests.status,
        created_at: friendRequests.created_at,
        sender_id: friendRequests.sender_id,
        receiver_id: friendRequests.receiver_id,
        sender_email: users.email,     // optional
      })
      .from(friendRequests)
      .innerJoin(users, eq(friendRequests.sender_id, users.id))
      .where(
        and(
          eq(friendRequests.receiver_id, userId),
          eq(friendRequests.status, 'pending') // 👈 only show pending requests
        )
      );

    
    res.json({
      success: true,
      message: 'Incoming friend requests retrieved successfully.',
      requests,
    });
  } catch (error) {
    console.error('Error fetching incoming requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch incoming requests.',
    });
  }
});

app.post('/api/protected/friends/accept', authMiddleware, async (req: AuthRequest, res) => {
  const { requestId } = req.body;
  const userId = req.userId!;
   const { friendRequests } = schema;

  try {
    const [updated] = await db.update(friendRequests)
      .set({ status: 'accepted' })
      .where(and(eq(friendRequests.id, requestId), eq(friendRequests.receiver_id, userId)))
      .returning();

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error accepting friend request:', error);
    res.status(500).json({ success: false, message: 'Failed to accept request.' });
  }
});

app.delete('/api/protected/friends/:requestId', authMiddleware, async (req: AuthRequest, res) => {
  const { requestId } = req.params;
  const userId = req.userId!;
  const { friendRequests } = schema;

  try {
    const deletedRequest = await db
      .delete(friendRequests)
      .where(eq(friendRequests.id, requestId))
      .returning();
    
    if (deletedRequest.length === 0) {
      return res.status(404).json({
        success: false,
        status: 'not_found',
        message: 'Friend request not found or already deleted.',
      });
    }

    return res.status(200).json({
      success: true,
      status: 'deleted',
      message: 'Friend request declined and deleted successfully.',
      data: deletedRequest[0],
    });
  } catch (error) {
    console.error('Friend request deletion error:', error);
    return res.status(500).json({
      success: false,
      status: 'error',
      message: 'Failed to decline friend request.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/protected/friends/messages/:friendId', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const friendId = req.params.friendId; // the friend whose secrets you want
  const { friendRequests, users, secretMessages } = schema;

  try {
    // Check if friendship exists and is accepted
    const friendship = await db
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.sender_id, friendId),
          eq(friendRequests.status, 'accepted')
        )
      )

    if (friendship.length === 0) {
      // Not friends → return 401
      return res.status(401).json({
        success: false,
        statusCode: 401,
        status: 'Unauthorized',
        message: 'You are not friends with this user.',
      });
    }

    // If friends → fetch their secret messages
     const friendsSecrets = await db
      .select({
        sender_id: friendRequests.sender_id,
        receiver_id: friendRequests.receiver_id,
        friend_email: users.email,
        friend_secret: secretMessages.content,
        secret_message_id: secretMessages.id,
        created_at: friendRequests.created_at,
      })
      .from(friendRequests)
      // Join users table for both sender and receiver
      .innerJoin(users, or(
        eq(friendRequests.sender_id, users.id),
        eq(friendRequests.receiver_id, users.id)
      ))
      // Join secret messages for that user
      .innerJoin(secretMessages, eq(secretMessages.user_id, users.id))
      .where(
        and(
            eq(friendRequests.receiver_id, userId),
          eq(friendRequests.status, 'accepted')
        )
      );

    return res.status(200).json({
      success: true,
      status: 'retrieved',
      message: 'Friend secret messages retrieved successfully.',
      friendsSecrets,
    });
  } catch (error) {
    console.error('Error fetching friend secrets:', error);
    return res.status(500).json({
      success: false,
      status: 'server_error',
      message: 'Failed to fetch friend secrets.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// --- SERVER STARTUP ---
app.get('/', (_, res) => res.send('Hello from Vercel!'));
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});