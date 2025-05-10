// scripts/reshare-and-deploy-scripts.js
// Purpose: Ensures all existing user scripts are shared with the service account
// and have an API executable deployment. Updates the DB with the deployment ID.
// Run with: node scripts/reshare-and-deploy-scripts.js

const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config(); // Load .env variables for GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, etc.

const prisma = new PrismaClient();

// Helper function to get Google API client authenticated AS THE USER (with auto-refresh)
async function getUserGoogleApiClient(userId) {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'google' },
    });
    if (!account?.access_token || !account?.refresh_token) {
      console.warn(`User ${userId}: Missing access or refresh token. Cannot get user Google API client.`);
      return null;
    }
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
    });
    auth.requestOptions = { quotaProjectId: process.env.GCP_PROJECT_ID };
    return auth;
  } catch (error) {
    console.error(`User ${userId}: Error creating user Google API client:`, error.message);
    return null;
  }
}

async function main() {
  console.log('Starting utility to reshare scripts and create/update deployments...');
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!serviceAccountEmail) {
    console.error('CRITICAL: GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is not set. Exiting.');
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    where: {
      userAppsScriptId: { not: null }, // Only users with a script
      // Optionally, filter for users missing a deploymentId if you only want to update those:
      // googleScriptDeploymentId: null,
    },
    select: {
      id: true,
      email: true,
      userAppsScriptId: true,
      googleScriptDeploymentId: true, // Select existing deploymentId to potentially update or skip
    },
  });

  console.log(`Found ${users.length} users with script IDs to process.`);

  for (const user of users) {
    console.log(`\n--- Processing User: ${user.email || user.id} (Script ID: ${user.userAppsScriptId}) ---`);

    const userAuth = await getUserGoogleApiClient(user.id);
    if (!userAuth) {
      console.warn(`User ${user.id}: Could not get user-authenticated Google client. Skipping this user.`);
      continue;
    }

    const drive = google.drive({ version: 'v3', auth: userAuth });
    const script = google.script({ version: 'v1', auth: userAuth });
    const currentScriptId = user.userAppsScriptId;

    try {
      // 1. Verify Script Existence (as user)
      console.log(`User ${user.id}: Verifying script ${currentScriptId} exists...`);
      await script.projects.get({ scriptId: currentScriptId });
      console.log(`User ${user.id}: Script ${currentScriptId} verified.`);

      // 2. Ensure Script is Shared with Service Account as 'writer' (using User Auth)
      console.log(`User ${user.id}: Checking/Updating share permissions for SA (${serviceAccountEmail}) on script ${currentScriptId}...`);
      try {
        const permissions = await drive.permissions.list({
          fileId: currentScriptId,
          fields: 'permissions(id,emailAddress,role)',
          supportsAllDrives: true,
        });
        const saPermission = permissions.data.permissions?.find(p => p.emailAddress === serviceAccountEmail);

        if (saPermission) {
          if (saPermission.role !== 'writer' && saPermission.role !== 'owner') {
            console.log(`User ${user.id}: SA has '${saPermission.role}', updating to 'writer'...`);
            await drive.permissions.update({
              fileId: currentScriptId,
              permissionId: saPermission.id,
              requestBody: { role: 'writer' },
              supportsAllDrives: true,
            });
            console.log(`User ${user.id}: SA permission updated to 'writer'.`);
          } else {
            console.log(`User ${user.id}: SA already has '${saPermission.role}' permission.`);
          }
        } else {
          console.log(`User ${user.id}: SA has no permission, adding 'writer'...`);
          await drive.permissions.create({
            fileId: currentScriptId,
            requestBody: {
              role: 'writer',
              type: 'user',
              emailAddress: serviceAccountEmail,
            },
            supportsAllDrives: true,
          });
          console.log(`User ${user.id}: SA permission added as 'writer'.`);
        }
      } catch (shareError) {
        console.error(`User ${user.id}: Failed to share/update script ${currentScriptId} with SA. Error:`, shareError.message);
        // Continue to next user if sharing fails, as deployment will also likely fail or be problematic
        continue; 
      }

      // 3. Create/Update Deployment (using User Auth)
      // We always create a new version and deployment to ensure the latest code is deployed.
      // If you have a complex versioning strategy, this might need adjustment.
      console.log(`User ${user.id}: Creating new version and deployment for script ${currentScriptId}...`);
      let newDeploymentIdToSave;
      try {
        console.log(`User ${user.id}: Creating new version for script...`);
        const version = await script.projects.versions.create({
          scriptId: currentScriptId,
          requestBody: { description: `Automated update by utility script - ${new Date().toISOString()}` },
        });
        const newVersionNumber = version.data.versionNumber;
        if (!newVersionNumber) throw new Error('Version created, but no version number returned.');
        console.log(`User ${user.id}: Created version ${newVersionNumber}.`);

        console.log(`User ${user.id}: Creating new deployment for version ${newVersionNumber}...`);
        // To update an existing deployment, you'd use deployments.update with the existing deploymentId.
        // For simplicity and to ensure latest code, we create a new one. 
        // Consider if you need to delete old deployments.
        const deployment = await script.projects.deployments.create({
          scriptId: currentScriptId,
          requestBody: {
            versionNumber: newVersionNumber,
            description: `API Executable - Updated by utility ${new Date().toISOString()}`,
            manifestFileName: 'appsscript' // Ensure this is correct
          },
        });
        newDeploymentIdToSave = deployment.data.deploymentId;
        if (!newDeploymentIdToSave) throw new Error('Deployment created, but no deployment ID returned.');
        console.log(`User ${user.id}: Created new deployment ID: ${newDeploymentIdToSave}.`);

        // Update DB
        await prisma.user.update({
          where: { id: user.id },
          data: { googleScriptDeploymentId: newDeploymentIdToSave },
        });
        console.log(`User ${user.id}: Successfully updated DB with new deploymentId: ${newDeploymentIdToSave}.`);

      } catch (deployError) {
        console.error(`User ${user.id}: Failed to create version/deployment for script ${currentScriptId}. Error:`, deployError.message);
        // Log and continue to the next user
      }

    } catch (scriptAccessError) {
      console.error(`User ${user.id}: Error accessing or processing script ${currentScriptId}. Error:`, scriptAccessError.message);
      // Continue to the next user
    }
  }

  console.log('\n--- Utility script finished. ---');
}

main()
  .catch(async (e) => {
    console.error('Unhandled error in main utility function:', e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 