/** Indexed read that fails loudly instead of yielding undefined (callers index within bounds). */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new RangeError(`print layout: no item at index ${index}`)
  return item
}
