declare module '../../lib/prisma' {
  const prisma: any;
  export default prisma;
}

declare module '../../lib/supabase' {
  export function supabaseAdmin(): any;
}
