"use client";

import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

/** dnd-kit's `attributes` + `listeners`, spread as two separate prop groups (`{...attrs}
 *  {...listeners}`) directly onto whichever grip button is visible at the current
 *  breakpoint (see `SortableAdminRow` below) — kept apart rather than merged into one
 *  object since their types don't intersect cleanly (`listeners` is index-signatured). */
export interface SortableHandleProps {
  attrs: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

/**
 * Drag-sortable `<div>` row for a single unified card-row list (desktop + mobile share
 * one `DndContext`/`SortableContext`, unlike the old split desktop-table/mobile-cards
 * layout). The render-prop hands back raw `handleProps` rather than a pre-built handle
 * element — callers render their own grip icon(s) (the design shows a different grip per
 * breakpoint: a lead 6-dot grip on desktop, a trailing grip on mobile only while in
 * reorder mode), all spreading the same `handleProps` onto whichever grip is visible.
 */
export function SortableAdminRow({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: (args: { handleProps: SortableHandleProps; isDragging: boolean }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(className, isDragging && "z-10 opacity-90 shadow-lg")}
    >
      {children({ handleProps: { attrs: attributes, listeners }, isDragging })}
    </div>
  );
}
