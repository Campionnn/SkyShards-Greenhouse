import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { debounce, getRarityTextColor } from "../../utilities";
import { CropImage } from "../shared";
import { cn } from "../ui/cn";
import { IconButton, KitInput } from "../ui/kit";
import { surface } from "../ui/surface";
import { useGreenhouseData } from "../../context";
import type { MutationDefinition } from "../../types/greenhouse";

interface MutationAutocompleteProps {
  mutations: MutationDefinition[];
  excludeIds?: string[];
  onSelect: (mutation: MutationDefinition) => void;
  placeholder?: string;
  className?: string;
}

export const MutationAutocomplete: React.FC<MutationAutocompleteProps> = ({
  mutations,
  excludeIds = [],
  onSelect,
  placeholder = "Search mutations...",
  className = "",
}) => {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MutationDefinition[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isSelecting, setIsSelecting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const availableMutations = useMemo(() => {
    return mutations.filter((m) => !excludeIds.includes(m.id));
  }, [mutations, excludeIds]);

  const debouncedSearch = useMemo(
    () =>
      debounce((searchQuery: string) => {
        if (searchQuery.length === 0 || isSelecting) {
          setSuggestions([]);
          setIsOpen(false);
          return;
        }

        const lowerQuery = searchQuery.toLowerCase();
        const results = availableMutations.filter((m) =>
          m.name.toLowerCase().includes(lowerQuery)
        );

        setSuggestions(results);
        setIsOpen(results.length > 0);
        setFocusedIndex(-1);
      }, 100),
    [availableMutations, isSelecting]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setIsSelecting(false);
      setQuery(newValue);
      debouncedSearch(newValue);
    },
    [debouncedSearch]
  );

  const handleSelect = useCallback(
    (mutation: MutationDefinition) => {
      setIsSelecting(true);
      setIsOpen(false);
      setSuggestions([]);
      setFocusedIndex(-1);
      setQuery("");

      onSelect(mutation);

      inputRef.current?.blur();

      setTimeout(() => {
        setIsSelecting(false);
      }, 50);
    },
    [onSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || suggestions.length === 0 || isSelecting) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % suggestions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev <= 0 ? suggestions.length - 1 : prev - 1
          );
          break;
        case "Enter":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < suggestions.length) {
            handleSelect(suggestions[focusedIndex]);
          } else if (suggestions.length > 0) {
            handleSelect(suggestions[0]);
          }
          break;
        case "Escape":
          setIsOpen(false);
          setFocusedIndex(-1);
          break;
      }
    },
    [isOpen, suggestions, isSelecting, focusedIndex, handleSelect]
  );

  const handleClear = useCallback(() => {
    setIsSelecting(false);
    setQuery("");
    setSuggestions([]);
    setIsOpen(false);
    setFocusedIndex(-1);
    inputRef.current?.focus();
  }, []);

  const handleInputFocus = useCallback(() => {
    if (isSelecting) return;

    // An empty query lists every available mutation.
    if (query.trim() === "") {
      setSuggestions(availableMutations);
      setIsOpen(availableMutations.length > 0);
    } else {
      debouncedSearch(query);
    }
  }, [isSelecting, query, availableMutations, debouncedSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        inputRef.current &&
        !inputRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("li");
      const focusedItem = items[focusedIndex];
      if (focusedItem) {
        focusedItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [focusedIndex]);

  // Reopen the list after a selection while the input keeps focus.
  useEffect(() => {
    if (!isSelecting && availableMutations.length > 0 && document.activeElement === inputRef.current) {
      setSuggestions(availableMutations);
      setIsOpen(true);
    }
  }, [availableMutations, isSelecting]);

  const formatName = (name: string) => name.replace(/_/g, " ");

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Plus aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-meta" />
        <KitInput
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={isOpen && suggestions.length > 0 && !isSelecting}
          aria-autocomplete="list"
          className="w-full pr-8 pl-8"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <IconButton size="sm" aria-label="Clear" className="absolute top-1/2 right-1 -translate-y-1/2" onClick={handleClear}>
            <X />
          </IconButton>
        )}
      </div>

      {isOpen && suggestions.length > 0 && !isSelecting && (
        <ul ref={listRef} role="listbox" className={cn(surface.raised, "scrollbar-dark absolute z-(--z-popover) mt-1 max-h-60 w-full overflow-y-auto p-1")}>
          {suggestions.map((mutation, index) => (
            <li
              key={mutation.id}
              role="option"
              aria-selected={index === focusedIndex}
              onClick={() => handleSelect(mutation)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={cn("flex cursor-pointer items-center gap-2 rounded-inner px-2 py-1.5 transition-colors duration-(--duration-hover)", index === focusedIndex ? "bg-surface-hover" : "")}
            >
              <CropImage cropId={mutation.id} cropName={mutation.name} size="xs" showFallback={false} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate text-body", getRarityTextColor(mutation.rarity))}>{mutation.name}</span>
                <span className="truncate text-meta text-fg-meta">
                  {mutation.requirements.map((r, i) => {
                    const displayName = getCropDef(r.crop)?.name || getMutationDef(r.crop)?.name || formatName(r.crop);
                    return (
                      <span key={r.crop}>
                        {i > 0 && ", "}
                        {r.count}× {displayName}
                      </span>
                    );
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOpen && suggestions.length === 0 && query.length > 0 && !isSelecting && (
        <div className={cn(surface.raised, "absolute z-(--z-popover) mt-1 w-full p-3 text-center text-secondary text-fg-meta")}>No mutations found</div>
      )}
    </div>
  );
};