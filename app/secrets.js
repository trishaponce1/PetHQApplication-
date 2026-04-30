// secrets.js — Portfolio Version
// Loads credentials from environment variables (.env file via dotenv)
// Original version used AWS Secrets Manager — see aws-original/secrets.js
//
// In the enterprise deployment (ISQA 8330 course project), this module
// fetched secrets from AWS Secrets Manager using the AWS CLI at startup,
// supporting three secrets: pethq/rds, pethq/dify, and pethq/cognito1.
// The portfolio version simplifies this to dotenv for portability.

require('dotenv').config();

let cachedSecrets = null;

async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;

  cachedSecrets = {
    rds: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'pethq',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'pethqadmin',
    },
    ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  };

  console.log('[Secrets] Loaded from environment variables');
  return cachedSecrets;
}

module.exports = { getSecrets };
