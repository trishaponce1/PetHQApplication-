-- schema.sql — PetHQ Database Schema & Seed Data
-- Run: psql -h <RDS-endpoint> -U postgres -d pethq -f schema.sql

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  species VARCHAR(50),
  breed VARCHAR(100),
  age VARCHAR(50),
  weight VARCHAR(50),
  allergies TEXT,
  food_brand VARCHAR(255),
  medical_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feeding_schedules (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
  meal_time VARCHAR(50),
  portion_size VARCHAR(100),
  food_type VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pet_goals (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
  goal_type VARCHAR(50) DEFAULT 'general',
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SEED DATA — Demo pets for portfolio
-- ============================================================

INSERT INTO users (email, name) VALUES
  ('demo@pethq.app', 'Demo User')
ON CONFLICT (email) DO NOTHING;

INSERT INTO pets (user_id, name, species, breed, age, weight, allergies, food_brand, medical_notes) VALUES
  (1, 'Peanut', 'Dog', 'Doodle', '1 year', '10lb', 'None', 'Open Farm Ancient Grains Puppy Food', 'Up to date on vaccines. Healthy weight.'),
  (1, 'Tony', 'Cat', 'Tabby', '3 years', '12lb', 'Chicken', 'Blue Buffalo Indoor Health', 'Indoor only. Annual checkup due June 2026.'),
  (1, 'Juice', 'Dog', 'Golden Retriever', '5 years', '65lb', 'None', 'Purina Pro Plan Sport', 'Hip dysplasia — monitor activity levels.')
ON CONFLICT DO NOTHING;

INSERT INTO feeding_schedules (pet_id, meal_time, portion_size, food_type) VALUES
  (1, 'Morning (7:00 AM)', '1/2 cup', 'Open Farm Ancient Grains Puppy'),
  (1, 'Evening (6:00 PM)', '1/2 cup', 'Open Farm Ancient Grains Puppy'),
  (2, 'Morning (8:00 AM)', '1/3 cup', 'Blue Buffalo Indoor Health'),
  (2, 'Evening (7:00 PM)', '1/3 cup', 'Blue Buffalo Indoor Health'),
  (3, 'Morning (6:30 AM)', '2 cups', 'Purina Pro Plan Sport'),
  (3, 'Evening (5:30 PM)', '2 cups', 'Purina Pro Plan Sport')
ON CONFLICT DO NOTHING;

INSERT INTO pet_goals (pet_id, goal_type, description, status) VALUES
  (1, 'training', 'Achieve Canine Good Citizen (CGC) certification', 'active'),
  (1, 'training', 'Consistent leash walking without pulling', 'active'),
  (3, 'health', 'Maintain healthy weight — target 60-65lb range', 'active'),
  (3, 'training', 'Improve recall command reliability off-leash', 'active')
ON CONFLICT DO NOTHING;
