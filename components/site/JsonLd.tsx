import Head from 'next/head';

/** Renders schema.org JSON-LD. `data` entries that are null are skipped. */
export default function JsonLd({ data, id }: { data: (Record<string, unknown> | null | undefined)[] | Record<string, unknown> | null; id?: string }) {
  const list = (Array.isArray(data) ? data : [data]).filter(Boolean);
  if (!list.length) return null;
  return (
    <Head>
      {list.map((d, i) => (
        <script
          key={`${id || 'ld'}-${i}`}
          type="application/ld+json"
          // JSON.stringify output only; `<` escaped so content can't close the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, '\\u003c') }}
        />
      ))}
    </Head>
  );
}
