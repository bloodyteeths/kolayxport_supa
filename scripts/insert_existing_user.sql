-- First, get the user's email and created_at from auth.users
SELECT email, created_at 
FROM auth.users 
WHERE id = '8441c3a4-f520-4e41-ba61-fca47b0f7f9c';

-- Then, insert into public.User (replace the values with what you got from the query above)
INSERT INTO public."User" (id, email, "createdAt", "updatedAt")
VALUES (
  '8441c3a4-f520-4e41-ba61-fca47b0f7f9c',
  'REPLACE_WITH_EMAIL_FROM_QUERY_ABOVE',
  'REPLACE_WITH_CREATED_AT_FROM_QUERY_ABOVE',
  'REPLACE_WITH_CREATED_AT_FROM_QUERY_ABOVE'
)
ON CONFLICT (id) DO NOTHING; 