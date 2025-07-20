import { toast } from 'react-hot-toast';

export function showLimitToast() {
  toast.error('Paket limitine ulaşıldı. Fiyatlandırma sayfasına yönlendiriliyorsunuz...', {
    duration: 3000
  });
  
  // Redirect to pricing page after 2 seconds
  setTimeout(() => {
    window.location.href = '/fiyatlandirma';
  }, 2000);
} 