-- Coin Snake Database Schema for Supabase
-- Run this in the Supabase SQL Editor

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  balance INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User stats table
CREATE TABLE user_stats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  games_played INTEGER DEFAULT 0,
  total_winnings INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  high_score INTEGER DEFAULT 0,
  kills INTEGER DEFAULT 0,
  deaths INTEGER DEFAULT 0
);

-- Transactions table (deposits, withdrawals, game results)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'game_win', 'game_loss', 'buy_in'
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices table (Lightning payments)
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  bolt11 TEXT,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'expired'
  payment_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

-- Game sessions table (for analytics)
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  buy_in INTEGER NOT NULL,
  final_score INTEGER,
  result TEXT, -- 'win', 'loss', 'cashout'
  killed_by TEXT,
  duration_seconds INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_game_sessions_user_id ON game_sessions(user_id);

-- Function to update user balance with transaction logging
CREATE OR REPLACE FUNCTION update_user_balance(
  p_user_id UUID,
  p_amount INTEGER,
  p_type TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE(new_balance INTEGER) AS $$
DECLARE
  v_balance_before INTEGER;
  v_balance_after INTEGER;
BEGIN
  -- Get current balance with row lock
  SELECT balance INTO v_balance_before
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_balance_after := v_balance_before + p_amount;

  -- Prevent negative balance (except for special cases)
  IF v_balance_after < 0 AND p_type NOT IN ('buy_in') THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Update balance
  UPDATE users
  SET balance = v_balance_after, updated_at = NOW()
  WHERE id = p_user_id;

  -- Log transaction
  INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, metadata)
  VALUES (p_user_id, p_type, p_amount, v_balance_before, v_balance_after, p_metadata);

  RETURN QUERY SELECT v_balance_after;
END;
$$ LANGUAGE plpgsql;

-- Function to create user with stats
CREATE OR REPLACE FUNCTION create_user_with_stats(
  p_username TEXT,
  p_nickname TEXT,
  p_password_hash TEXT
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  INSERT INTO users (username, nickname, password_hash)
  VALUES (LOWER(p_username), p_nickname, p_password_hash)
  RETURNING id INTO v_user_id;

  INSERT INTO user_stats (user_id)
  VALUES (v_user_id);

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (optional but recommended)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;

-- Policies (users can only see their own data)
-- Note: For server-side operations, use the service_role key which bypasses RLS
