-- Migration: Add Etsy addresses table for Chrome extension data
-- This table stores address enrichment data from Etsy Chrome extension

CREATE TABLE IF NOT EXISTS etsy_addresses (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_number VARCHAR(255) NOT NULL,
    etsy_store_id VARCHAR(255), -- Optional: Etsy shop ID for multi-store users
    etsy_store_name VARCHAR(255), -- Optional: Human-readable store name
    shipping_address JSONB NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance  
CREATE INDEX idx_etsy_addresses_user_order ON etsy_addresses(user_id, order_number);
CREATE INDEX idx_etsy_addresses_user_store_order ON etsy_addresses(user_id, etsy_store_id, order_number);
CREATE INDEX idx_etsy_addresses_order_number ON etsy_addresses(order_number);
CREATE INDEX idx_etsy_addresses_created_at ON etsy_addresses(created_at);

-- Ensure unique constraint per user per store per order
CREATE UNIQUE INDEX idx_etsy_addresses_unique_user_store_order ON etsy_addresses(user_id, COALESCE(etsy_store_id, ''), order_number);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_etsy_addresses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_etsy_addresses_updated_at
    BEFORE UPDATE ON etsy_addresses
    FOR EACH ROW
    EXECUTE FUNCTION update_etsy_addresses_updated_at();