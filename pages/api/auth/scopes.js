import { getRequiredScopes } from '@/lib/googleServiceAccountAuth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }
  
  try {
    const scopes = getRequiredScopes();
    
    // Return different formats based on query param
    const format = req.query.format || 'json';
    
    if (format === 'text') {
      // Return plain text list
      return res.status(200).send(scopes.join('\n'));
    } else if (format === 'csv') {
      // Return comma-separated list
      return res.status(200).send(scopes.join(','));
    } else {
      // Default to JSON
      return res.status(200).json({
        scopes,
        commaSeparated: scopes.join(','),
        count: scopes.length,
        message: 'These scopes must be configured in the Google Admin console for Domain-Wide Delegation',
        serviceAccountEnvVar: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'Set' : 'Not set',
        domainWideDelegation: process.env.DOMAIN_WIDE_DELEGATION === 'true' ? 'Enabled' : 'Disabled'
      });
    }
  } catch (error) {
    console.error('Error retrieving scopes:', error);
    return res.status(500).json({ 
      error: 'Failed to retrieve scope information',
      message: error.message
    });
  }
} 