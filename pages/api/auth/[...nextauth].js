import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import prisma from "@/lib/prisma";

const defaultAdapter = PrismaAdapter(prisma);
const customAdapter = {
  ...defaultAdapter,
  async getUserByAccount(params) {
    console.log("[DEBUG] getUserByAccount:", params);
    const res = await defaultAdapter.getUserByAccount(params);
    console.log("[DEBUG] getUserByAccount result:", res);
    return res;
  },
  async getUserByEmail(email) {
    console.log("[DEBUG] getUserByEmail:", email);
    const user = await defaultAdapter.getUserByEmail(email);
    console.log("[DEBUG] getUserByEmail result:", user);
    return user;
  },
  async linkAccount(accountData) {
    console.log("[DEBUG] linkAccount data:", accountData);
    return defaultAdapter.linkAccount(accountData);
  },
};

export const authOptions = {
  adapter: customAdapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: [ // Request scopes needed for onboarding & Execution API
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/script.projects",
            "https://www.googleapis.com/auth/script.scriptapp",
            "https://www.googleapis.com/auth/script.external_request",
            "https://www.googleapis.com/auth/script.storage",
          ].join(" "),
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    // Log signIn flow to inspect account/profile from provider
    async signIn({ user, account, profile }) {
      console.log("[DEBUG] signIn callback account:", account);
      console.log("[DEBUG] signIn callback profile:", profile);
      return true; // allow NextAuth to auto-create user & account
    },
    // --- Session Callback --- 
    async session({ session, user }) {
      session.user.id = user.id; // Add the user ID from the DB
      // Add other DB fields needed on the client
      session.user.googleScriptId = user.googleScriptId;
      session.user.googleSheetId = user.googleSheetId;
      session.user.driveFolderId = user.driveFolderId;

      console.log("Session Callback (DB Strategy) - Populated Session:", session);
      return session;
    },

    // --- SignIn Callback (Optional - Onboarding Logic Here?) ---
    // This is a good place to check if it's a first-time sign-in
    // async signIn({ user, account, profile }) {
    //   if (account.provider === 'google') {
    //     const userInDb = await prisma.user.findUnique({ where: { email: user.email } });
    //     if (!userInDb?.googleScriptId) { // Check if onboarding is complete
    //       console.log(`User ${user.email} needs onboarding.`);
    //       // Trigger onboarding process asynchronously - don't block sign-in
    //       // fetch('/api/onboarding/setup', { method: 'POST', /* pass necessary user/account info */ });
    //       // Or set a flag on the user object/session to indicate pending onboarding
    //     }
    //   }
    //   return true; // Allow sign in
    // },
  },
  // Optional: Add pages configuration if you want custom sign-in pages
  // pages: {
  //   signIn: '/auth/signin',
  // }
};

export default NextAuth(authOptions); 