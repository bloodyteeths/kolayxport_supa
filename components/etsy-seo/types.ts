export type SeoExperimentItem = {
  id: string;
  shopId: string;
  listingCount: number;
  listings: Array<{ listingId: string; title: string | null; thumbnail: string | null }>;
  changeKinds: string[];
  changedAt: string;
  windowDays: number;
  readyAfter: string;
  status: 'collecting' | 'low_traffic' | 'ready' | 'insufficient_data' | 'confounded' | 'cancelled' | string;
  controlType: 'shop' | 'category' | 'none' | null;
  seasonal: boolean;
  evaluatedAt: string | null;
  verdict: 'improved' | 'worse' | 'inconclusive' | null;
  confidence: 'high' | 'medium' | 'low' | null;
  metrics: any;
  kind: 'kolayxport' | 'external';
};
