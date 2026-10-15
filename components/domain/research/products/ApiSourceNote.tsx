// Renders an API `source` (lib/research/types SourceNoteProps: i18n key + params, fetchedAt, sample, excluded,
// kind) through the DS SourceNote. Missing source → nothing (a region without data has no note).
import { SourceNote } from '@/components/ds/research/SourceNote';
import type { SampleUnit } from '@/components/ds/research/types';
import type { SourceNoteProps as ApiSource } from '@/lib/research/types';

export type ApiSourceNoteProps = {
  source: ApiSource | null | undefined;
  /** Overrides the API `sampleTotal` ("287 of 300 listings used"). */
  sampleTotal?: number;
  sampleUnit?: SampleUnit;
  meta?: string;
  'data-testid'?: string;
};

export function ApiSourceNote({ source, sampleTotal, sampleUnit, meta, 'data-testid': testId }: ApiSourceNoteProps) {
  if (!source || typeof source.source !== 'string' || !source.fetchedAt) return null;
  return (
    <SourceNote
      source={source.source}
      sourceParams={source.sourceParams}
      fetchedAt={source.fetchedAt}
      sample={typeof source.sample === 'number' ? source.sample : undefined}
      sampleTotal={sampleTotal ?? source.sampleTotal}
      sampleUnit={sampleUnit ?? source.sampleUnit}
      excluded={source.excluded ? { count: source.excluded.count, reasonKey: source.excluded.reasonKey, reasonParams: source.excluded.reasonParams } : undefined}
      kind={source.kind ?? 'measured'}
      meta={meta}
      data-testid={testId}
    />
  );
}

export default ApiSourceNote;
