import { Search, SlidersHorizontal } from "lucide-react";

import { Input } from "@easytable/ui/components/input";

type FilterOption = {
  label: string;
  value: string;
};

type CatalogFilter = {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
};

type CatalogFiltersProps = {
  search: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  filters?: CatalogFilter[];
};

export function CatalogFilters({
  search,
  searchPlaceholder,
  onSearchChange,
  filters = [],
}: CatalogFiltersProps) {
  return (
    <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 pl-9"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          value={search}
        />
      </div>
      {filters.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {filters.map((filter) => (
            <label className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-3" key={filter.id}>
              <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">{filter.label}</span>
              <select
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => filter.onChange(event.target.value)}
                value={filter.value}
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
