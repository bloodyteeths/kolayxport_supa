import { getProviders, signIn } from "next-auth/react";
import Link from "next/link";
import PublicLayout from "../../components/PublicLayout";
import { Globe } from 'lucide-react'; // Using Globe as a generic Google icon placeholder, can be replaced

// Floating label input component (can be moved to a separate file if reused)
const FloatingLabelInput = ({ id, label, type = "text", ...props }) => (
  <div className="relative">
    <input
      type={type}
      id={id}
      className="block px-3 py-3.5 w-full text-sm text-slate-900 bg-transparent rounded-lg border border-slate-300 appearance-none focus:outline-none focus:ring-0 focus:border-primary peer"
      placeholder=" " // Important for peer to work
      {...props}
    />
    <label
      htmlFor={id}
      className="absolute text-sm text-slate-500 duration-300 transform -translate-y-4 scale-75 top-2 z-10 origin-[0] bg-white/0 px-2 peer-focus:px-2 peer-focus:text-primary peer-placeholder-shown:scale-100 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:top-1/2 peer-focus:top-2 peer-focus:scale-75 peer-focus:-translate-y-4 rtl:peer-focus:translate-x-1/4 rtl:peer-focus:left-auto start-1"
    >
      {label}
    </label>
  </div>
);

export default function SignIn({ providers }) {
  return (
    <PublicLayout title="Giriş Yap - KolayXport">
      <div className="flex items-center justify-center min-h-[calc(100vh-144px)] md:min-h-[calc(100vh-72px)] bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
        {/* Adjusted min-height to account for potential footer height (72px approx) and nav height (72px) */}
        <div className="max-w-sm w-full space-y-8">
          <div className="rounded-3xl bg-white/70 backdrop-blur-md p-8 sm:p-10 shadow-xl border border-slate-200/50">
            <div className="text-center mb-8">
                {/* Optional: Logo can go here */}
                {/* <img className="mx-auto h-12 w-auto" src="/kolayxport-logo.png" alt="KolayXport" /> */}
                <h2 className="mt-6 text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                KolayXport'a Giriş
                </h2>
            </div>
            
            {Object.values(providers).map((provider) => {
              if (provider.name === "Google") { // Only show Google for now, or adapt for others
                return (
                  <div key={provider.name} className="space-y-6">
                    <button
                      onClick={() => signIn(provider.id, { callbackUrl: '/app' })}
                      className="btn-primary w-full flex items-center justify-center gap-x-2" // Using new btn-primary
                    >
                      <Globe size={20} /> {/* Placeholder Google Icon */}
                      Google ile Giriş Yap
                    </button>
                  </div>
                );
              }
              return null;
            })}

            <div className="my-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white/0 text-slate-500 backdrop-blur-sm">
                    veya e-posta ile devam et
                  </span>
                </div>
              </div>
            </div>

            <form className="space-y-6" onSubmit={(e) => e.preventDefault()}> {/* Prevent default for now */}
              <FloatingLabelInput id="email" label="E-posta Adresi" type="email" autoComplete="email" required />
              <FloatingLabelInput id="password" label="Şifre" type="password" autoComplete="current-password" required />
              
              {/* Add remember me and forgot password if needed */}
              {/* <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input id="remember-me" name="remember-me" type="checkbox" className="h-4 w-4 text-primary focus:ring-primary-dark border-slate-300 rounded" />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-900">Beni hatırla</label>
                </div>
                <div className="text-sm">
                  <a href="#" className="font-medium text-primary hover:text-primary-dark">Şifreni mi unuttun?</a>
                </div>
              </div> */}

              <div>
                <button
                  type="submit"
                  disabled // Disable email/password login for now as only Google provider is focused
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary/70 hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Giriş Yap (Devre Dışı)
                </button>
              </div>
            </form>

            <div className="text-sm text-center mt-8">
              <p className="text-slate-600">
                Hesabın yok mu?{' '}
                <Link href="/auth/signup" className="font-medium text-primary hover:text-primary-dark hover:underline">
                  Kaydol
                </Link> 
                {/* Assuming /auth/signup will be the path. If not, adjust or point to a relevant page */}
              </p>
            </div>

          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

export async function getServerSideProps(context) {
  const providers = await getProviders();
  return {
    props: { providers },
  };
} 