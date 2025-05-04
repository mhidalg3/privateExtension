export function getNonce(): string {
  return [...Array(32)]
    .map(() => Math.floor(Math.random() * 36).toString(36))
    .join('');
}
