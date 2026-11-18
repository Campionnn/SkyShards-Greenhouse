import React from "react";
import { Palette } from "lucide-react";
import { Dropdown, MenuItem, MenuLabel } from "../ui/Popover";
import { setTheme, THEMES, useTheme } from "../../theme/theme";

/** The header's colour theme picker: a palette icon that opens a menu of themes (colours only). */
export const ThemeMenu: React.FC = () => {
  const theme = useTheme();
  return (
    <Dropdown
      label="Colour theme"
      title="Colour theme"
      look="plain"
      chevron={false}
      width={220}
      align="end"
      className="grid size-11 shrink-0 place-items-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg lg:size-[30px] lg:border lg:border-line lg:hover:bg-surface-hover"
      button={<Palette aria-hidden className="size-5 lg:size-3.5" />}
    >
      {(close) => (
        <>
          <MenuLabel>Theme</MenuLabel>
          {THEMES.map((t) => (
            <MenuItem
              key={t.id}
              checked={theme === t.id}
              hint={t.hint}
              onSelect={() => {
                setTheme(t.id);
                close();
              }}
            >
              {t.label}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
};
