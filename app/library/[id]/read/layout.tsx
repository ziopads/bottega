import { Suspense } from 'react';

import PdfPane from '@/app/_library/PdfPane';
import { Section } from '@/app/_ui/layout';

// The page reader's frame: the page (header, page controls, the page's text)
// on the left, the PDF on the right.
//
// The PDF pane lives here, not in page.tsx, because Next.js treats a page with
// different search parameters (?page=824, ?page=825) as a different page and
// mounts it afresh: a pane inside the page would lose its loaded file on every
// turn. A layout is not remounted when only the search parameters change, so
// the pane keeps the file and follows the page number from the address.
// Nothing here reads data; the page itself checks who is asking, and the pane
// asks the file route, which checks again.

export default async function ReadLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
      <div className="min-w-0">{children}</div>
      <div className="min-w-0 lg:sticky lg:top-4 lg:mt-3 lg:self-start">
        <Section label="The PDF">
          {Number.isInteger(id) && id > 0 ? (
            <Suspense fallback={null}>
              <PdfPane documentId={id} />
            </Suspense>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
