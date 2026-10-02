import React, { useState } from "react";
import { CropSearchInput } from "./CropSearchInput";
import { CropFilterDropdown, type FilterOption } from "./CropFilterDropdown";
import { CROP_FILTER_OPTIONS } from "../../constants";
import type { CropFilterCategory } from "../../types/greenhouse";

export interface SearchFilterHeaderProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  
  filter: CropFilterCategory;
  onFilterChange: (value: CropFilterCategory) => void;
  filterOptions?: FilterOption[];
  
  className?: string;
  searchClassName?: string;
  filterClassName?: string;
}

/** Search box plus filter dropdown (Calculator and Designer); owns the dropdown open state. */
export const SearchFilterHeader: React.FC<SearchFilterHeaderProps> = ({
  searchTerm,
  onSearchChange,
  searchPlaceholder = "Search...",
  filter,
  onFilterChange,
  filterOptions = [...CROP_FILTER_OPTIONS],
  className = "",
  searchClassName = "",
  filterClassName = "",
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  
  return (
    <div className={`flex gap-2 ${className}`}>
      <CropSearchInput
        value={searchTerm}
        onChange={onSearchChange}
        placeholder={searchPlaceholder}
        className={`flex-1 ${searchClassName}`}
      />
      
      <CropFilterDropdown
        value={filter}
        onChange={onFilterChange}
        options={filterOptions}
        isOpen={isFilterOpen}
        onToggle={() => setIsFilterOpen(!isFilterOpen)}
        onClose={() => setIsFilterOpen(false)}
        className={filterClassName}
      />
    </div>
  );
};
