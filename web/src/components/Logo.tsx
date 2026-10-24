/** RecPick mark: a TV screen with a record dot. Keep in sync with the favicon in index.html. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#6d5ce8" />
      <rect x="6" y="8" width="20" height="14" rx="3" fill="#fff" />
      <path d="M12 26h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="15" r="3.6" fill="#ef4444" />
    </svg>
  );
}
