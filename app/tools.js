// tools.js — MCP Tools Layer
// Defines available tools and executes them based on the user's question
// In true MCP, the LLM would request these tools on demand.
// In our implementation (Pattern 1), the orchestrator pre-fetches relevant
// tool outputs based on keyword detection before the LLM sees the question.
// This is a known trade-off due to small model limitations (tinyllama).

const { getPool } = require('./context');

// ─────────────────────────────────────────────
// Tool Definitions
// These describe what tools are available to the LLM.
// In a full MCP implementation these would be sent to the LLM first
// so it could request only the ones it needs.
// ─────────────────────────────────────────────
const AVAILABLE_TOOLS = [
  {
    name: 'get_pet_profile',
    description: 'Retrieve pet profile details for personalization.',
    inputSchema: { petId: 'string' }
  },
  {
    name: 'get_feeding_schedule',
    description: 'Retrieve the feeding schedule for a pet including meal times and portion sizes.',
    inputSchema: { petId: 'string' }
  },
  {
    name: 'get_medical_records',
    description: 'Retrieve medical records, vaccines, and health notes for a pet.',
    inputSchema: { petId: 'string' }
  },
  {
    name: 'get_training_goals',
    description: 'Retrieve active training goals and behavior targets for a pet.',
    inputSchema: { petId: 'string' }
  },
  {
    name: 'log_event',
    description: 'Log a pet event such as a vaccine, symptom, or training session.',
    inputSchema: {
      petId: 'string',
      eventType: 'vaccine|symptom|training|note',
      eventDate: 'YYYY-MM-DD',
      notes: 'string'
    }
  }
];

// ─────────────────────────────────────────────
// Keyword Maps — determines which tools to invoke
// based on what the user is asking about
// ─────────────────────────────────────────────
const TOOL_KEYWORDS = {
  get_feeding_schedule: [
    'feed', 'food', 'eat', 'meal', 'portion', 'cup', 'hungry',
    'diet', 'nutrition', 'kibble', 'snack', 'treat', 'how much'
  ],
  get_training_goals: [
    'train', 'training', 'goal', 'goals', 'behavior', 'behaviour',
    'citizen', 'cgc', 'leash', 'command', 'obedience', 'sit', 'stay',
    'come', 'recall', 'pull', 'manners', 'certification', 'achieve'
  ],
  get_medical_records: [
    'vaccine', 'vaccination', 'vet', 'medical', 'health', 'sick',
    'allergy', 'allergies', 'medication', 'medicine', 'symptom',
    'shot', 'appointment', 'checkup', 'records', 'history'
  ],
  log_event: [
    'log', 'record', 'track', 'note', 'just had', 'just got',
    'received', 'visited', 'went to the vet'
  ]
};

// ─────────────────────────────────────────────
// Tool Implementations
// ─────────────────────────────────────────────

/**
 * get_pet_profile — always runs when a pet is selected
 * Returns full pet profile from RDS
 */
async function get_pet_profile(petId) {
  try {
    const db = await getPool();
    const result = await db.query('SELECT * FROM pets WHERE id = $1', [petId]);
    if (result.rows.length === 0) return null;
    const pet = result.rows[0];
    return {
      tool: 'get_pet_profile',
      result: {
        petId: String(pet.id),
        name: pet.name,
        species: pet.species,
        breed: pet.breed,
        age: pet.age,
        weight: pet.weight,
        allergies: pet.allergies,
        foodBrand: pet.food_brand,
        medicalNotes: pet.medical_notes
      }
    };
  } catch (err) {
    console.error('get_pet_profile error:', err.message);
    return null;
  }
}

/**
 * get_feeding_schedule — fetches feeding schedule from RDS
 * Returns meal times and portions for the pet
 */
async function get_feeding_schedule(petId) {
  try {
    const db = await getPool();
    const result = await db.query(
      'SELECT * FROM feeding_schedules WHERE pet_id = $1 ORDER BY id',
      [petId]
    );
    if (result.rows.length === 0) {
      return {
        tool: 'get_feeding_schedule',
        result: { message: 'No feeding schedule found for this pet.' }
      };
    }
    return {
      tool: 'get_feeding_schedule',
      result: {
        meals: result.rows.map(row => ({
          mealTime: row.meal_time,
          portionSize: row.portion_size,
          foodType: row.food_type,
          notes: row.notes
        }))
      }
    };
  } catch (err) {
    console.error('get_feeding_schedule error:', err.message);
    return null;
  }
}

/**
 * get_medical_records — fetches medical notes from RDS pets table
 * Returns health flags, allergies, and medical history
 */
async function get_medical_records(petId) {
  try {
    const db = await getPool();
    const result = await db.query('SELECT * FROM pets WHERE id = $1', [petId]);
    if (result.rows.length === 0) return null;
    const pet = result.rows[0];
    return {
      tool: 'get_medical_records',
      result: {
        petId: String(pet.id),
        name: pet.name,
        allergies: pet.allergies || 'None on record',
        medicalNotes: pet.medical_notes || 'No medical notes on record',
        medicalFlags: pet.medical_notes ? [pet.medical_notes] : []
      }
    };
  } catch (err) {
    console.error('get_medical_records error:', err.message);
    return null;
  }
}

/**
 * get_training_goals — fetches active training goals from pet_goals table
 */
async function get_training_goals(petId) {
  try {
    const db = await getPool();
    const result = await db.query(
      'SELECT * FROM pet_goals WHERE pet_id = $1 ORDER BY created_at DESC',
      [petId]
    );
    if (result.rows.length === 0) {
      return {
        tool: 'get_training_goals',
        result: { message: 'No training goals found for this pet.' }
      };
    }
    return {
      tool: 'get_training_goals',
      result: {
        goals: result.rows.map(g => ({
          goalType: g.goal_type,
          description: g.description,
          status: g.status
        }))
      }
    };
  } catch (err) {
    console.error('get_training_goals error:', err.message);
    return null;
  }
}

/**
 * log_event — logs a pet event to the medical_records table
 * Handles vaccine, symptom, training, or general note
 */
async function log_event(petId, eventType, notes) {
  try {
    const eventDate = new Date().toISOString().split('T')[0];
    // Store as a medical note update for now
    const db = await getPool();
    await db.query(
      `UPDATE pets SET medical_notes = CONCAT(COALESCE(medical_notes, ''), $1) WHERE id = $2`,
      [`\n[${eventDate}] ${eventType}: ${notes}`, petId]
    );
    return {
      tool: 'log_event',
      result: {
        success: true,
        message: `Logged ${eventType} event for pet ${petId} on ${eventDate}.`,
        eventType,
        eventDate,
        notes
      }
    };
  } catch (err) {
    console.error('log_event error:', err.message);
    return { tool: 'log_event', result: { success: false, message: err.message } };
  }
}

// ─────────────────────────────────────────────
// Tool Invocation Engine
// Decides which tools to run based on the user's message
// and executes them in parallel
// ─────────────────────────────────────────────

/**
 * invokeTool — main entry point for the orchestrator
 * Keyword-matches the user message, runs relevant tools,
 * returns all tool results to be bundled into the LLM context
 *
 * @param {string} userMessage
 * @param {number|null} petId
 * @returns {Array} array of tool results
 */
async function invokeTools(userMessage, petId = null) {
  if (!petId) return [];

  const messageLower = userMessage.toLowerCase();
  const toolsToRun = new Set(['get_pet_profile']); // always run profile

  // Keyword detection — determine which additional tools to invoke
  for (const [toolName, keywords] of Object.entries(TOOL_KEYWORDS)) {
    for (const keyword of keywords) {
      if (messageLower.includes(keyword)) {
        toolsToRun.add(toolName);
        break;
      }
    }
  }

  console.log(`[MCP] Tools invoked for "${userMessage}":`, [...toolsToRun]);

  // Execute all matched tools in parallel
  const toolPromises = [];
  for (const toolName of toolsToRun) {
    if (toolName === 'get_pet_profile') toolPromises.push(get_pet_profile(petId));
    if (toolName === 'get_feeding_schedule') toolPromises.push(get_feeding_schedule(petId));
    if (toolName === 'get_medical_records') toolPromises.push(get_medical_records(petId));
    if (toolName === 'get_training_goals') toolPromises.push(get_training_goals(petId));
  }

  const results = await Promise.all(toolPromises);
  return results.filter(r => r !== null);
}

module.exports = { invokeTools, AVAILABLE_TOOLS };
