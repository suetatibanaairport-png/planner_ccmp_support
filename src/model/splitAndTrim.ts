/** 区切り文字で分割し、各要素をトリムして空要素を除去する。 */
export function splitAndTrim(value: string, delimiter: string): string[] {
  return value
    .split(delimiter)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
