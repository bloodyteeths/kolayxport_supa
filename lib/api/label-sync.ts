export async function syncLabelOrders(userId: string): Promise<number> {
  const res = await fetch('/api/orders/labelSync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Unknown sync error');

  return (json as { imported: number }).imported;
}
