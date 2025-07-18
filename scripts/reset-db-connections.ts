import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetConnections() {
  console.log('Resetting database connections...');
  
  try {
    // Disconnect current client
    await prisma.$disconnect();
    console.log('Disconnected from database');
    
    // Create new client with fresh connections
    const newPrisma = new PrismaClient();
    
    // Test the connection
    const result = await newPrisma.$queryRaw`SELECT 1 as test`;
    console.log('Database connection test successful:', result);
    
    // Close the test connection
    await newPrisma.$disconnect();
    
    console.log('Database connections reset successfully!');
  } catch (error) {
    console.error('Error resetting database connections:', error);
  }
}

resetConnections();