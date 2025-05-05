import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';

const plans = [
  { id: 'basic', label: 'Temel: 1 pazaryeri + 1 kargo – ₺149/ay', price: 14900 },
  { id: 'advanced', label: 'Gelişmiş: 3 pazaryeri + 2 kargo – ₺299/ay', price: 29900 },
  { id: 'pro', label: 'Profesyonel: Sınırsız – ₺499/ay', price: 49900 },
];

export default function SubscribePage() {
  const [selectedPlan, setSelectedPlan] = useState(plans[0].id);
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const json = await res.json();
      if (res.ok && json.checkoutUrl) {
        window.location.href = json.checkoutUrl;
      } else {
        toast.error(json.error || 'Failed to start checkout');
      }
    } catch (err) {
      console.error(err);
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded shadow">
      <h1 className="text-2xl font-bold mb-4">Abonelik</h1>
      <div className="space-y-4">
        {plans.map((plan) => (
          <div key={plan.id} className="flex items-center">
            <input
              type="radio"
              id={plan.id}
              name="plan"
              value={plan.id}
              checked={selectedPlan === plan.id}
              onChange={() => setSelectedPlan(plan.id)}
              className="mr-2"
            />
            <label htmlFor={plan.id} className="flex-1">{plan.label}</label>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Button onClick={handleSubscribe} disabled={loading} className="w-full">
          {loading ? 'Yönlendiriliyor...' : 'Ödeme Sayfasına Git'}
        </Button>
      </div>
    </div>
  );
} 