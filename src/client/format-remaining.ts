export const SECOND_MS = 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / SECOND_MS));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}
