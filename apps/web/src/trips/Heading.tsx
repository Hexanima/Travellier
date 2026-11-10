import { createElement, type ComponentPropsWithoutRef } from "react";

/** A heading whose level depends on where the screen is rendered (inside the Trip shell everything is one level deeper). */
export function Heading({ level, ...props }: { level: 1 | 2 | 3 | 4 | 5 | 6 } & ComponentPropsWithoutRef<"h2">) {
  return createElement(`h${level}`, props);
}
