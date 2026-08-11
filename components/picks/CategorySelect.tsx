"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { resolveCategoryMenuPlacement } from "@/utils/category-select-position";
import type { Pick8Category } from "@/utils/pick8-entry-validation";

const VIEWPORT_MARGIN = 12;
const MENU_GAP = 4;

type CategoryOption = {
  key: Pick8Category | "";
  label: string;
  muted: boolean;
};

export default function CategorySelect({
  value,
  options,
  disabled,
  invalid,
  ariaLabel,
  onChange,
}: {
  value: Pick8Category | "";
  options: CategoryOption[];
  disabled: boolean;
  invalid: boolean;
  ariaLabel: string;
  onChange: (value: Pick8Category | "") => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOptions: CategoryOption[] = [
    { key: "", label: "Not selected", muted: false },
    ...options,
  ];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, menuOptions.findIndex((option) => option.key === value)),
  );
  const selectedOption = menuOptions.find((option) => option.key === value);
  const visibleOpen = open && !disabled;

  useEffect(() => {
    if (!visibleOpen) return;
    const closeWhenOutside = (event: PointerEvent | FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
    };
  }, [visibleOpen]);

  useLayoutEffect(() => {
    if (!visibleOpen) return;

    const positionMenu = () => {
      const trigger = buttonRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      menu.style.maxHeight = "none";
      menu.style.overflowY = "visible";
      menu.style.maxWidth = `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`;
      menu.style.left = "0";
      menu.style.right = "auto";

      const triggerRect = trigger.getBoundingClientRect();
      const placement = resolveCategoryMenuPlacement({
        fullHeight: menu.scrollHeight,
        availableBelow: window.innerHeight - triggerRect.bottom - MENU_GAP - VIEWPORT_MARGIN,
        availableAbove: triggerRect.top - MENU_GAP - VIEWPORT_MARGIN,
      });

      if (placement.direction === "down") {
        menu.style.top = `calc(100% + ${MENU_GAP}px)`;
        menu.style.bottom = "auto";
      } else {
        menu.style.top = "auto";
        menu.style.bottom = `calc(100% + ${MENU_GAP}px)`;
      }
      if (placement.maxHeight === null) {
        menu.style.maxHeight = "none";
        menu.style.overflowY = "visible";
      } else {
        menu.style.maxHeight = `${placement.maxHeight}px`;
        menu.style.overflowY = "auto";
      }

      if (menu.getBoundingClientRect().right > window.innerWidth - VIEWPORT_MARGIN) {
        menu.style.left = "auto";
        menu.style.right = "0";
      }
      const alignedRect = menu.getBoundingClientRect();
      if (alignedRect.left < VIEWPORT_MARGIN) {
        menu.style.left = `${VIEWPORT_MARGIN - triggerRect.left}px`;
        menu.style.right = "auto";
      }
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [visibleOpen]);

  function keepOptionVisible(index: number) {
    window.requestAnimationFrame(() => {
      const menu = menuRef.current;
      const option = menu?.querySelector<HTMLElement>(`[data-option-index="${index}"]`);
      if (!menu || !option || menu.scrollHeight <= menu.clientHeight) return;
      const optionTop = option.offsetTop;
      const optionBottom = optionTop + option.offsetHeight;
      if (optionTop < menu.scrollTop) menu.scrollTop = optionTop;
      else if (optionBottom > menu.scrollTop + menu.clientHeight) {
        menu.scrollTop = optionBottom - menu.clientHeight;
      }
    });
  }

  function openList() {
    const selectedIndex = menuOptions.findIndex((option) => option.key === value);
    const next = selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex(next);
    setOpen(true);
    keepOptionVisible(next);
  }

  function choose(index: number) {
    const option = menuOptions[index];
    if (!option) return;
    onChange(option.key);
    setActiveIndex(index);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "Escape") {
      if (visibleOpen) event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (visibleOpen) choose(activeIndex);
      else openList();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!visibleOpen) {
        openList();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = (current + direction + menuOptions.length) % menuOptions.length;
        keepOptionVisible(next);
        return next;
      });
      return;
    }
    if (visibleOpen && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : menuOptions.length - 1;
      setActiveIndex(next);
      keepOptionVisible(next);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={visibleOpen}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={visibleOpen ? `${id}-option-${activeIndex}` : undefined}
        aria-invalid={invalid}
        disabled={disabled}
        className={`brand-input mt-0 flex min-h-11 items-center justify-between gap-3 text-left ${invalid ? "border-red-400/80 bg-red-950/40" : ""}`}
        onClick={() => visibleOpen ? setOpen(false) : openList()}
        onKeyDown={handleKeyDown}
      >
        <span className={selectedOption ? "text-white" : "text-slate-400"}>{selectedOption?.label ?? "Not selected"}</span>
        <span aria-hidden="true" className={`shrink-0 text-xs text-slate-400 transition ${visibleOpen ? "rotate-180" : ""}`}>▼</span>
      </button>
      {visibleOpen ? (
        <div
          ref={menuRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 z-30 w-full min-w-48 rounded-xl border border-white/15 bg-[#07111f] p-1 shadow-2xl shadow-black/50"
        >
          {menuOptions.map((option, index) => {
            const selected = option.key === value;
            const active = index === activeIndex;
            return (
              <div
                key={option.key}
                id={`${id}-option-${index}`}
                data-option-index={index}
                role="option"
                aria-selected={selected}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm sm:min-h-10 ${active ? "bg-white/10" : ""} ${option.muted && !selected ? "text-slate-500" : "text-white"}`}
                onMouseMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {selected ? <span aria-hidden="true" className="font-black text-emerald-300">✓</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
