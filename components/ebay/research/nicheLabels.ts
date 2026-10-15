import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

/**
 * R0: niche score explanations, localized from the score with the same
 * thresholds the API used. Replaces the hardcoded Turkish `demandLabel`,
 * `competitionLabel` and `opportunityLabel` strings the API used to return
 * (old saved niches may still carry them; they are ignored).
 */
export function useNicheVerdicts() {
  const t = useTranslations('research.ebayNiche');
  const demand = useCallback((score: number) =>
    t(score >= 70 ? 'demandHigh' : score >= 40 ? 'demandMedium' : 'demandLow'), [t]);
  const competition = useCallback((score: number) =>
    t(score >= 70 ? 'competitionHigh' : score >= 40 ? 'competitionMedium' : 'competitionLow'), [t]);
  const opportunity = useCallback((score: number) =>
    t(score >= 70 ? 'opportunityExcellent' : score >= 50 ? 'opportunityGood' : score >= 30 ? 'opportunityRisky' : 'opportunityPoor'), [t]);
  return { demand, competition, opportunity };
}
