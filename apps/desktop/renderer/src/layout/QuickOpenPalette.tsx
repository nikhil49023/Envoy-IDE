import { useEffect, useMemo, useState } from "react";

export type QuickOpenItem = {
  id: string;
  kind: "file" | "action";
  label: string;
  description?: string;
  path?: string;
};

type QuickOpenPaletteProps = {
  open: boolean;
  query: string;
  setQuery: (value: string) => void;
  items: QuickOpenItem[];
  onClose: () => void;
  onChoose: (item: QuickOpenItem) => void;
};

export function QuickOpenPalette({
  open,
  query,
  setQuery,
  items,
  onClose,
  onChoose,
}: QuickOpenPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setSelectedIndex(0);
    }
  }, [open, query]);

  const safeIndex = useMemo(() => {
    if (items.length === 0) {
      return 0;
    }
    return Math.min(selectedIndex, items.length - 1);
  }, [items.length, selectedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, items.length - 1)));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const item = items[safeIndex];
        if (item) {
          onChoose(item);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [items, onChoose, onClose, open, safeIndex]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="quick-open-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="quick-open-panel glass-panel">
        <input
          className="quick-open-input"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type file or command..."
        />

        <div className="quick-open-meta">
          <span>{items.length} results</span>
          <span>Use arrows and Enter</span>
        </div>

        <ul className="quick-open-list">
          {items.length === 0 ? (
            <li className="quick-open-empty">No matches</li>
          ) : (
            items.map((item, index) => (
              <li key={item.id}>
                <button
                  className={`quick-open-item ${index === safeIndex ? "active" : ""}`.trim()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => onChoose(item)}
                >
                  <span className={`quick-open-kind ${item.kind}`}>{item.kind === "file" ? "F" : "A"}</span>
                  <span className="quick-open-text">
                    <span className="quick-open-label">{item.label}</span>
                    {item.description ? (
                      <span className="quick-open-description">{item.description}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
