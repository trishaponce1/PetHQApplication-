// context.js — MCP Context Builder
// Builds the structured JSON context object that gets sent to the LLM
// Think of this as the "Data" layer in the MCP pattern
// The App EC2 (orchestrator) calls this before invoking any tools or the model

const { Pool } = require('pg');
const { getSecrets } = require('./secrets');

let pool;

// Initialize pool from Secrets Manager on first use
async function getPool() {
  if (pool) return pool;
  const secrets = await getSecrets();
  pool = new Pool({
    host: secrets.rds.host,
    port: secrets.rds.port,
    database: secrets.rds.database,
    user: secrets.rds.user,
    password: secrets.rds.password,
    ssl: { rejectUnauthorized: false },
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
  });
  return pool;
}

/**
 * Builds the MCP context bundle for a given pet and user message.
 * This is the structured JSON object the App Tier constructs before calling Ollama.
 * It should be structured, minimal, and permission-aware.
 *
 * @param {string} userMessage - The user's chat message
 * @param {number|null} petId - The selected pet's ID from RDS (optional)
 * @returns {object} MCP context bundle
 */
async function buildContext(userMessage, petId = null) {
  const context = {
    request: {
      requestId: `req-${Date.now()}`,
      timestamp: new Date().toISOString(),
      channel: 'web',
      userMessage: userMessage
    },
    user: {
      userId: 'demo-user',
      location: {
        city: 'Omaha',
        state: 'NE',
        zip: '681xx'
      },
      preferences: {
        tone: 'friendly',
        units: 'imperial'
      }
    },
    pet: null,
    goals: {
      primary: 'general',
      details: []
    },
    recentHistory: []
  };

  // If a pet is selected, fetch their full profile from RDS
  if (petId) {
    try {
      const db = await getPool();
      const [petResult, goalsResult] = await Promise.all([
        db.query('SELECT * FROM pets WHERE id = $1', [petId]),
        db.query('SELECT * FROM pet_goals WHERE pet_id = $1 AND status = $2 ORDER BY created_at DESC', [petId, 'active'])
      ]);

      if (petResult.rows.length > 0) {
        const pet = petResult.rows[0];
        context.pet = {
          petId: String(pet.id),
          name: pet.name || '',
          species: pet.species || 'dog',
          breed: pet.breed || '',
          ageYears: pet.age || '',
          weightLbs: pet.weight || '',
          medicalFlags: pet.medical_notes ? [pet.medical_notes] : [],
          vaccines: [],
          trainingLevel: 'beginner',
          allergies: pet.allergies || '',
          foodBrand: pet.food_brand || ''
        };

        // Include active training goals in context
        if (goalsResult.rows.length > 0) {
          context.goals.primary = goalsResult.rows[0].goal_type;
          context.goals.details = goalsResult.rows.map(g => g.description);
        }

        // Infer primary goal from pet data if no goals set
        if (context.goals.details.length === 0 && pet.medical_notes && pet.medical_notes.toLowerCase().includes('weight')) {
          context.goals.primary = 'weight';
        } else if (context.goals.details.length === 0) {
          context.goals.primary = 'health';
        }
      }
    } catch (err) {
      console.error('Context builder RDS error:', err.message);
    }
  }

  return context;
}

module.exports = { buildContext, getPool };
