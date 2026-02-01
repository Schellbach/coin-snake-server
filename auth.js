import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { supabase, isSupabaseConfigured } from './supabase'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'coin-snake-secret-change-in-production'
)

// Fallback in-memory store for demo mode
const memoryStore = {
  users: new Map(),
  sessions: new Map()
}

// Password hashing using Web Crypto API
export async function hashPassword(password) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + (process.env.SALT || 'coin-snake-salt'))
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// Create a new user
export async function createUser(username, password) {
  const hashedPassword = await hashPassword(password)

  if (isSupabaseConfigured()) {
    // Check if username exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username.toLowerCase())
      .single()

    if (existing) {
      throw new Error('Username already exists')
    }

    // Create user with stats using the stored function
    const { data, error } = await supabase
      .rpc('create_user_with_stats', {
        p_username: username,
        p_nickname: username,
        p_password_hash: hashedPassword
      })

    if (error) {
      console.error('Supabase error:', error)
      throw new Error('Failed to create user')
    }

    // Fetch the created user
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, username, nickname, balance, created_at')
      .eq('id', data)
      .single()

    if (fetchError) throw new Error('Failed to fetch user')

    return user
  } else {
    // Demo mode - in-memory
    if (memoryStore.users.has(username.toLowerCase())) {
      throw new Error('Username already exists')
    }

    const user = {
      id: crypto.randomUUID(),
      username: username.toLowerCase(),
      nickname: username,
      password: hashedPassword,
      balance: 0,
      created_at: new Date().toISOString()
    }

    memoryStore.users.set(username.toLowerCase(), user)
    return sanitizeUser(user)
  }
}

// Validate user login
export async function validateUser(username, password) {
  const hashedPassword = await hashPassword(password)

  if (isSupabaseConfigured()) {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, nickname, balance, password_hash, created_at')
      .eq('username', username.toLowerCase())
      .single()

    if (error || !user) {
      throw new Error('Invalid username or password')
    }

    if (user.password_hash !== hashedPassword) {
      throw new Error('Invalid username or password')
    }

    const { password_hash, ...safeUser } = user
    return safeUser
  } else {
    // Demo mode
    const user = memoryStore.users.get(username.toLowerCase())
    if (!user || user.password !== hashedPassword) {
      throw new Error('Invalid username or password')
    }
    return sanitizeUser(user)
  }
}

// Remove sensitive fields from user object
export function sanitizeUser(user) {
  const { password, password_hash, ...safeUser } = user
  return safeUser
}

// Create JWT session token
export async function createSession(userId) {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)

  return token
}

// Verify JWT session token
export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload
  } catch {
    return null
  }
}

// Get current user from session cookie
export async function getCurrentUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get('session')?.value

  if (!token) return null

  const payload = await verifySession(token)
  if (!payload) return null

  if (isSupabaseConfigured()) {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, nickname, balance, created_at')
      .eq('id', payload.userId)
      .single()

    if (error) return null
    return user
  } else {
    // Demo mode
    for (const user of memoryStore.users.values()) {
      if (user.id === payload.userId) {
        return sanitizeUser(user)
      }
    }
    return null
  }
}

// Get user by ID
export async function getUserById(userId) {
  if (isSupabaseConfigured()) {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, nickname, balance, created_at')
      .eq('id', userId)
      .single()

    if (error) return null
    return user
  } else {
    for (const user of memoryStore.users.values()) {
      if (user.id === userId) {
        return sanitizeUser(user)
      }
    }
    return null
  }
}

// Update user balance with transaction logging
export async function updateUserBalance(userId, amount, type = 'adjustment', metadata = {}) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .rpc('update_user_balance', {
        p_user_id: userId,
        p_amount: amount,
        p_type: type,
        p_metadata: metadata
      })

    if (error) {
      console.error('Balance update error:', error)
      throw new Error(error.message || 'Failed to update balance')
    }

    // Fetch updated user
    return getUserById(userId)
  } else {
    // Demo mode
    for (const [username, user] of memoryStore.users.entries()) {
      if (user.id === userId) {
        user.balance += amount
        memoryStore.users.set(username, user)
        return sanitizeUser(user)
      }
    }
    throw new Error('User not found')
  }
}

// Set user balance directly (for special cases)
export async function setUserBalance(userId, balance) {
  if (isSupabaseConfigured()) {
    const { error } = await supabase
      .from('users')
      .update({ balance, updated_at: new Date().toISOString() })
      .eq('id', userId)

    if (error) throw new Error('Failed to set balance')
    return getUserById(userId)
  } else {
    for (const [username, user] of memoryStore.users.entries()) {
      if (user.id === userId) {
        user.balance = balance
        memoryStore.users.set(username, user)
        return sanitizeUser(user)
      }
    }
    throw new Error('User not found')
  }
}

// Get user transaction history
export async function getUserTransactions(userId, limit = 50) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return []
    return data
  }
  return [] // Demo mode doesn't track transactions
}

// Get user stats
export async function getUserStats(userId) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error) return null
    return data
  }
  return null
}

// Update user stats after game
export async function updateUserStats(userId, gameResult) {
  if (isSupabaseConfigured()) {
    const { data: currentStats } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (!currentStats) return

    const updates = {
      games_played: currentStats.games_played + 1,
      deaths: gameResult.died ? currentStats.deaths + 1 : currentStats.deaths,
      kills: currentStats.kills + (gameResult.kills || 0),
      high_score: Math.max(currentStats.high_score, gameResult.score || 0)
    }

    if (gameResult.profit > 0) {
      updates.total_winnings = currentStats.total_winnings + gameResult.profit
    } else if (gameResult.profit < 0) {
      updates.total_losses = currentStats.total_losses + Math.abs(gameResult.profit)
    }

    await supabase
      .from('user_stats')
      .update(updates)
      .eq('user_id', userId)
  }
}

// Create game session record
export async function createGameSession(userId, buyIn) {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('game_sessions')
      .insert({
        user_id: userId,
        buy_in: buyIn
      })
      .select()
      .single()

    if (error) return null
    return data
  }
  return { id: crypto.randomUUID() }
}

// End game session
export async function endGameSession(sessionId, result) {
  if (isSupabaseConfigured()) {
    await supabase
      .from('game_sessions')
      .update({
        final_score: result.score,
        result: result.type,
        killed_by: result.killedBy,
        duration_seconds: result.duration,
        ended_at: new Date().toISOString()
      })
      .eq('id', sessionId)
  }
}
