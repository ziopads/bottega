// Embedding, the only model calls Bottega makes (ARCHITECTURE §2, §5).
//
// MODEL, DIMENSION AND INPUT TYPE MUST MATCH ACROSS THE CORPUS. Chunks are
// embedded with input_type 'document' and queries with 'query', both
// voyage-4 at 1024 dimensions; documents.embedding_model and embedding_dim
// record what each document was embedded with. Change one side and every
// score is meaningless without any error to say so.
//
// A plain fetch to Voyage's REST endpoint, as in Scriptorium: no SDK. The key
// (VOYAGE_API_KEY) is Bottega's own Voyage account (REQUIREMENTS O-6).

export const EMBED_MODEL = 'voyage-4';
export const EMBED_DIM = 1024;

/** Texts per request. Bottega's chunks are about 2,000 characters, so a full batch is well under Voyage's token cap. */
const BATCH = 64;
const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

export class EmbedError extends Error {
  constructor(
    message: string,
    /** Voyage asked us to wait (HTTP 429); seconds, when it said. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export function embedConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}

async function call(input: string[], inputType: 'document' | 'query'): Promise<{ vectors: number[][]; tokens: number }> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new EmbedError('VOYAGE_API_KEY is not set');

  // Two attempts on a rate limit, waiting what Voyage asks (capped), then give up
  // and let the caller report it: a processing batch is retried by the page.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, model: EMBED_MODEL, input_type: inputType, output_dimension: EMBED_DIM }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 20;
      if (attempt < 2 && wait <= 30) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new EmbedError('The embedding service is rate-limiting Bottega.', wait);
    }
    if (!res.ok) throw new EmbedError(`Voyage embeddings: HTTP ${res.status}`);

    const body = (await res.json()) as { data?: { embedding?: number[]; index?: number }[]; usage?: { total_tokens?: number } };
    const data = body.data ?? [];
    if (data.length !== input.length) throw new EmbedError('Voyage embeddings: unexpected response');
    const vectors = new Array<number[]>(input.length);
    for (const [i, d] of data.entries()) {
      const at = typeof d.index === 'number' ? d.index : i;
      if (!Array.isArray(d.embedding) || d.embedding.length !== EMBED_DIM) {
        throw new EmbedError('Voyage embeddings: unexpected response');
      }
      vectors[at] = d.embedding;
    }
    return { vectors, tokens: body.usage?.total_tokens ?? 0 };
  }
}

/** Chunks for storage, in order, with the tokens Voyage counted. */
export async function embedDocuments(texts: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  const vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += BATCH) {
    const r = await call(texts.slice(i, i + BATCH), 'document');
    vectors.push(...r.vectors);
    tokens += r.tokens;
  }
  return { vectors, tokens };
}

/** A search query. */
export async function embedQuery(text: string): Promise<number[]> {
  return (await call([text], 'query')).vectors[0];
}

/** The literal Postgres reads as a vector or halfvec. */
export function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}
