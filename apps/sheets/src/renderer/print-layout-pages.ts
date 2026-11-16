/// The print job's page sizes for the shared layout panel's diagram and checks,
/// straight from the laid-out documents: every page of a sheet has that sheet's
/// paper (orientation applied), so nothing is rendered to count them.
import type { PageSize } from '@genoffice/print-layout/plan'

import type { PrintOutputSettings } from './page-layout-actions'
import type { SheetPrintDocument } from './print-html'

const PT_PER_INCH = 72

/// Pages outside `pages` (1-based, inclusive) are not part of the job, like
/// the print request's `include`.
export function printJobPageSizes(
  documents: readonly Pick<SheetPrintDocument, 'paper' | 'pages'>[],
  pages: PrintOutputSettings['pages'],
): PageSize[] {
  const sizes: PageSize[] = []
  let jobPage = 0
  for (const document of documents) {
    const size: PageSize = {
      widthPt: document.paper.widthIn * PT_PER_INCH,
      heightPt: document.paper.heightIn * PT_PER_INCH,
    }
    for (let index = 0; index < document.pages.length; index += 1) {
      jobPage += 1
      if (pages === null || (jobPage >= pages.from && jobPage <= pages.to)) sizes.push(size)
    }
  }
  return sizes
}
