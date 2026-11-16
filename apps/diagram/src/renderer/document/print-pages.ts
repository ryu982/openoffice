/**
 * The pages a print takes (spec 5): every page or the page on screen, as
 * light SVGs at each page's own format (the print document's sheets), and
 * the sheet sizes the print dialog's layout diagram draws. Print and the PDF
 * export gather pages the same way, so both show the same sheets in either
 * app theme.
 */
import type { PageSize } from '@genoffice/print-layout/plan'
import type { PageInfo } from '../../shared/bridge-protocol'
import type { ExportScope, PrintDiagramRequest, PrintPage, PrintResult } from '../../shared/ipc'
import { sheetSizePt } from '../../shared/print-sizes'
import type { DrawioFrame } from '../drawio/frame-client'
import { printPageOf } from './page-pictures'

type PageClient = Pick<DrawioFrame, 'request'>

/** The pages of a scope, numbered from 1 in diagram order. */
export async function pagesInScope(
  client: PageClient,
  scope: ExportScope,
): Promise<Array<PageInfo & { number: number }>> {
  const info = await client.request('pageInfo', {})
  const all = info.pages.map((page, index) => ({ ...page, number: index + 1 }))
  return scope === 'all' ? all : all.filter((page) => page.id === info.currentPage)
}

/** The sheets of a scope as the print document shows them. */
export async function printPagesIn(client: PageClient, scope: ExportScope): Promise<PrintPage[]> {
  const pages: PrintPage[] = []
  for (const page of await pagesInScope(client, scope)) {
    pages.push(await printPageOf(client, page))
  }
  return pages
}

/** The sheet sizes of a scope in points: no pictures are made for these. */
export async function printSheetSizesIn(
  client: PageClient,
  scope: ExportScope,
): Promise<PageSize[]> {
  return (await pagesInScope(client, scope)).map(sheetSizePt)
}

/** The print as it always was: the scope's sheets in the app's hidden print window. */
export async function plainPrint(
  api: { print(request: PrintDiagramRequest): Promise<PrintResult> },
  client: PageClient,
  scope: ExportScope,
  title: string,
): Promise<PrintResult> {
  return api.print({ pages: await printPagesIn(client, scope), title })
}
