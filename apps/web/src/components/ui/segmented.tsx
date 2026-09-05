import Link from "next/link";

export interface SegmentedItem {
  href: string;
  label: string;
  active: boolean;
}

/** Link-based toggle (grid/list, slot tabs, date ranges) — server-renderable, no state. */
export function Segmented({ items, ariaLabel }: { items: SegmentedItem[]; ariaLabel?: string | undefined }) {
  return (
    <div className="inline-flex rounded-lg border border-ink-700 p-0.5" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ${
            item.active ? "bg-ink-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
