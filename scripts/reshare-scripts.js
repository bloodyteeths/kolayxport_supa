// scripts/reshare-scripts.js
// Utility script to re-share existing user scripts with the service account
// using 'writer' permissions instead of 'reader' permissions
// Run with: node scripts/reshare-scripts.js

const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

// Function to get Google API client authenticated as the user
async function getUserGoogleApiClient(userId) {
  try {
    // Find the user's OAuth tokens in the Account table
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'google' }
    });
    
    if (!account?.access_token) {
      console.error(`No access token found for user ${userId}`);
      return null;
    }
    
    // Create an OAuth2 client with the user's tokens
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    
    auth.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: account.expires_at * 1000
    });
    
    return auth;
  } catch (error) {
    console.error(`Error setting up auth for user ${userId}:`, error);
    return null;
  }
}

async function main() {
  console.log('Starting script re-sharing utility...');
  
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!serviceAccountEmail) {
    console.error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in .env');
    process.exit(1);
  }
  
  try {
    // Find all users who have a script ID
    const users = await prisma.user.findMany({
      where: {
        userAppsScriptId: { not: null }
      },
      select: {
        id: true,
        email: true,
        name: true,
        userAppsScriptId: true
      }
    });
    
    console.log(`Found ${users.length} users with script IDs to process`);
    
    // Process each user's script
    for (const user of users) {
      console.log(`\nProcessing user: ${user.email || user.id}`);
      console.log(`Script ID: ${user.userAppsScriptId}`);
      
      const auth = await getUserGoogleApiClient(user.id);
      if (!auth) {
        console.log(`Skipping user ${user.id} - could not get auth client`);
        continue;
      }
      
      const drive = google.drive({ version: 'v3', auth });
      
      try {
        // Check if the script exists and is accessible by the user
        await drive.files.get({
          fileId: user.userAppsScriptId,
          fields: 'id,name,mimeType'
        });
        
        console.log(`Successfully verified script exists: ${user.userAppsScriptId}`);
        
        // Update permission for service account
        try {
          // First check if permission already exists
          const permissions = await drive.permissions.list({
            fileId: user.userAppsScriptId,
            fields: 'permissions(id,emailAddress,role)'
          });
          
          const existingPermission = permissions.data.permissions?.find(
            p => p.emailAddress === serviceAccountEmail
          );
          
          if (existingPermission) {
            console.log(`Found existing permission for ${serviceAccountEmail}: ${existingPermission.role}`);
            
            if (existingPermission.role !== 'writer' && existingPermission.role !== 'owner') {
              // Update existing permission to writer
              await drive.permissions.update({
                fileId: user.userAppsScriptId,
                permissionId: existingPermission.id,
                requestBody: {
                  role: 'writer'
                }
              });
              console.log(`Updated permission to 'writer' for ${serviceAccountEmail}`);
            } else {
              console.log(`Already has sufficient permission (${existingPermission.role})`);
            }
          } else {
            // Create new permission
            await drive.permissions.create({
              fileId: user.userAppsScriptId,
              requestBody: {
                role: 'writer',
                type: 'user',
                emailAddress: serviceAccountEmail
              },
              supportsAllDrives: true
            });
            console.log(`Added new 'writer' permission for ${serviceAccountEmail}`);
          }
        } catch (permError) {
          console.error(`Permission operation failed for script ${user.userAppsScriptId}:`, permError.message);
        }
      } catch (scriptError) {
        console.error(`Error accessing script ${user.userAppsScriptId}:`, scriptError.message);
      }
    }
    
    console.log('\nRe-sharing operation completed');
  } catch (error) {
    console.error('Error in main process:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error); 