## Pocket design system — conventions for building with it

Pocket is a dark-default fintech portfolio tracker (equities, gold, bonds, mutual
funds, cash). These are the real shadcn/ui + Radix primitives the Pocket app ships —
build screens out of them directly; don't invent lookalike markup.

### No wrapper required (one exception)

Every component here reads its color/spacing from CSS custom properties set on
`:root` / `.dark` in `styles.css` — there is no theme-context provider to mount.
Just render the component; it's styled.

**Exception — `DatePicker`** reads `next-intl`'s locale context (`useTranslations`,
`useLocale`) and throws outside it. Wrap any composition that uses it:

```tsx
<NextIntlClientProvider locale="en" messages={messages}>
  <DatePicker value={value} onChange={onChange} label="Ex-date" />
</NextIntlClientProvider>
```

`Toaster` reads `next-themes`' `useTheme()` but degrades gracefully outside a
`ThemeProvider` (falls back to `"system"`) — no wrapper needed.

### Styling idiom: Tailwind v4 utilities over semantic CSS variables

Never write raw hex colors or arbitrary pixel values for things the token set
already names — style with the same semantic utility classes the components
themselves use. The family below is real and verified against the compiled
stylesheet (`styles.css` → `_ds_bundle.css`):

| Purpose         | Classes                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface         | `bg-background`, `bg-card`, `bg-card-2` (subtler card), `bg-popover`, `bg-secondary`, `bg-muted`, `bg-accent`                                                                                                                                                                    |
| Text            | `text-foreground`, `text-muted-foreground`, `text-text-2` / `text-text-3` / `text-text-mute` (Pocket's secondary-text ramp, darkest→lightest emphasis), `text-card-foreground`                                                                                                   |
| Brand / state   | `text-primary` / `bg-primary` (Pocket green), `text-success` / `bg-success`, `text-warning` / `bg-warning`, `text-destructive` / `bg-destructive` — pair with `/15` or `/10` opacity modifiers for tinted fills (`bg-destructive/15`), the pattern `Badge` and `ErrorBanner` use |
| Borders / lines | `border-border`, `border-line` (hairline table/list dividers), `divide-border`                                                                                                                                                                                                   |
| Radius          | `rounded-xl` (cards, the app default), `rounded-[13px]` (inputs/tabs — Pocket's specific radius, not a Tailwind default step), `rounded-md` (small controls)                                                                                                                     |
| Elevation       | `shadow-card` (the only shadow token — a two-layer soft card shadow; don't use Tailwind's default `shadow-md`/`shadow-lg` scale)                                                                                                                                                 |
| Numbers         | `tabular` (tabular-nums for money/metrics — always pair with monetary or count values, e.g. `className={cn(TABLE_VALUE, "text-text-mute")}`)                                                                                                                                     |

Dark mode is a `.dark` class toggle on an ancestor (normally `<html>`), not a
separate component prop — every token above already has a `.dark` value, so
components re-theme automatically.

`Table`'s cell typography isn't baked into `TableCell` (weight/role varies by
column) — compose with the exported string constants: `TABLE_LABEL`,
`TABLE_SUBLABEL`, `TABLE_VALUE`, `TABLE_VALUE_STRONG`, `TABLE_SUBVALUE`. See
`Table.prompt.md` / the `Holdings` preview for the pattern.

### Where the truth lives

- `styles.css` (imports `_ds_bundle.css`) — the full compiled token set and every
  component's real Tailwind output. Read it before guessing a class exists.
- Each `components/<group>/<Name>/<Name>.prompt.md` — per-component API notes.
- Brand fonts (Plus Jakarta Sans for UI, DM Mono for tabular figures) load via a
  Google Fonts `@import` in `styles.css` — already wired, nothing to add.

### Building a screen: compose, don't reinvent

Real composition from this DS (a holdings card):

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  TABLE_VALUE,
  TABLE_VALUE_STRONG,
} from "pocket-ui";

<Card className="w-full">
  <CardHeader>
    <CardTitle>Holdings</CardTitle>
    <CardDescription>Across all portfolios, incl. cash</CardDescription>
  </CardHeader>
  <CardContent>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Instrument</TableHead>
          <TableHead>Class</TableHead>
          <TableHead className="text-right">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Vanguard FTSE All-World</TableCell>
          <TableCell>
            <Badge variant="outline">Equities</Badge>
          </TableCell>
          <TableCell className={TABLE_VALUE_STRONG}>€20,663.20</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </CardContent>
</Card>;
```

Overlays (`Dialog`, `Sheet`, `DropdownMenu`, `Popover`) render inline in their own
portal — no separate mount point needed; just render them where the trigger lives.

### Which overlay: task tier, refinement tier, or chrome

Pick by what the overlay _is_, not by breakpoint — the breakpoint is handled inside
the primitive, not by choosing a different component per viewport:

- **Task tier** (forms, detail views, anything the user is "inside" for more than a
  glance — add/edit portfolio, add/edit holder, transaction detail, add-transaction) —
  `DialogContent` with a `size` (`sm` 480 / `md` 600 / `lg` 880 / `xl` 1080). One
  mounted tree: full-screen page below `md`, a centered card at `md:`+, switched in CSS
  (`max-md:`/`md:` classes on the same element), never `{isDesktop ? <A/> : <B/>}` — a
  JS branch on a media query unmounts one tree and mounts the other, which loses
  whatever the user typed the moment they resize or rotate across the breakpoint. Pass
  `mobileHeader={{ title }}` for the mobile back-chevron + title row, and `footer` for
  a pinned, non-scrolling action bar (accepts `true` for a bare portal slot when the
  form's own submit button self-portals via `useSheetFooter()`).
- **Refinement tier** (filters, quick pickers — a glance-and-dismiss, not a place you
  "are") — `Popover`/`DropdownMenu` on desktop, a compact `Sheet` on mobile. These _can_
  still pick their component via a `useMediaQuery` JS branch — losing an unsaved filter
  selection on resize isn't a real regression the way losing a half-typed form is.
- **Chrome** (contextual bars that coexist with app navigation, e.g. a selection-mode
  action bar) — not a `Dialog`/`Sheet` at all; register with
  `useFullScreenOverlayRegistration` so `BottomNav` hides itself while a task-tier
  overlay is open, without the bar itself trying to be a modal.

`Sheet` (built on `vaul`, not Radix Dialog — drag-to-close) is now refinement-tier
only; it's no longer the task-tier "mobile modal."
