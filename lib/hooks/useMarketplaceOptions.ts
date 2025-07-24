import useSWR from 'swr';

interface MarketplaceOption {
  value: string;
  label: string;
  count: number;
}

interface MarketplaceOptionsResponse {
  marketplaces: MarketplaceOption[];
}

const fetcher = (url: string) => {
  return fetch(url).then(res => {
    if (!res.ok) {
      throw new Error(`Network response was not ok: ${res.status} ${res.statusText}`);
    }
    return res.json();
  });
};

export function useMarketplaceOptions() {
  const { data, error, isLoading } = useSWR<MarketplaceOptionsResponse>(
    '/api/orders/marketplace-options',
    fetcher,
    {
      refreshInterval: 300000, // Refresh every 5 minutes
      dedupingInterval: 60000, // Dedupe for 1 minute
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  return {
    marketplaceOptions: data?.marketplaces || [],
    isLoading,
    isError: !!error,
  };
}