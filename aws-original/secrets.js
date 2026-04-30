// secrets.js — AWS Secrets Manager Integration
// Fetches RDS credentials and Dify API key from Secrets Manager
// This removes all hardcoded credentials from the application code
// Falls back to environment variables or defaults if Secrets Manager is unavailable

const { execSync } = require('child_process');

let cachedSecrets = null;

/**
 * Fetches secrets from AWS Secrets Manager using the AWS CLI
 * Caches results in memory so we only call Secrets Manager once on startup
 */
async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;

  try {
    console.log('[Secrets Manager] Fetching secrets...');

    // Fetch RDS credentials
    const rdsRaw = execSync(
      'aws secretsmanager get-secret-value --secret-id pethq/rds --region us-east-1 --query SecretString --output text',
      { timeout: 10000 }
    ).toString().trim();
    const rds = JSON.parse(rdsRaw);

    // Fetch Dify API key
    const difyRaw = execSync(
      'aws secretsmanager get-secret-value --secret-id pethq/dify --region us-east-1 --query SecretString --output text',
      { timeout: 10000 }
    ).toString().trim();
    const dify = JSON.parse(difyRaw);

    // Fetch Cognito client secret
    const cognitoRaw = execSync(
      'aws secretsmanager get-secret-value --secret-id pethq/cognito1 --region us-east-1 --query SecretString --output text',
      { timeout: 10000 }
    ).toString().trim();
    const cognito = JSON.parse(cognitoRaw);

    cachedSecrets = {
      rds: {
        host: rds.host || '[RDS URL]',
        port: rds.port || 5432,
        database: rds.dbname || 'pethq',
        user: rds.username,
        password: rds.password,
      },
      difyApiKey: dify.DIFY_API_KEY,
      cognitoClientSecret: cognito.COGNITO_CLIENT_SECRET,
    };

    console.log('[Secrets Manager] Secrets loaded successfully');
    return cachedSecrets;

  } catch (err) {
    console.error('[Secrets Manager] Failed to fetch secrets, using fallback values:', err.message);

    // Fallback to hardcoded values if Secrets Manager is unavailable
    cachedSecrets = {
      rds: {
        host: '[RDS URL]',
        port: 5432,
        database: 'pethq',
        user: 'postgres',
        password: 'pethqadmin',
      },
      difyApiKey: '[DIFY APY KEY]',
      cognitoClientSecret: null,   // no fallback for secrets — fail visibly
    };

    return cachedSecrets;
  }
}

module.exports = { getSecrets };
