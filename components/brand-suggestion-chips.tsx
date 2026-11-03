"use client";

import { filterBrandSuggestions } from "@/lib/brand-suggestions";

// 前に入れたブランドを、タップで入力欄に入れられる候補として出す
// （服のフォームとクイック仕分けで共通。自由入力はそのまま）
export function BrandSuggestionChips({
  suggestions,
  input,
  onSelect,
  disabled = false,
}: {
  suggestions: ReadonlyArray<string>;
  input: string;
  onSelect: (brand: string) => void;
  disabled?: boolean;
}) {
  const chips = filterBrandSuggestions(suggestions, input);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="前に入れたブランド">
      {chips.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(suggestion)}
          className="inline-flex h-8 items-center rounded-full border bg-background px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
