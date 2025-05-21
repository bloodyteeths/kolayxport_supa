import AuthForm from '../components/AuthForm';
import PublicLayout from '../components/PublicLayout';

export default function LoginPage() {
  return (
    <PublicLayout title="Giriş Yap / Kayıt Ol">
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <AuthForm />
      </div>
    </PublicLayout>
  );
} 