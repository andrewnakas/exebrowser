# Pipe Panic — provenance

**Original work, written for ExeBrowser.** The HTML and JavaScript in this
directory were written from scratch for this site. No third-party code, no
decompiled binary, no extracted artwork — the pipes are drawn with canvas
rectangles.

Licensed **MIT**, the same as the rest of the ExeBrowser frontend.

## On the genre

Laying pipe ahead of an advancing flow goes back to *Pipe Mania* (1989) and the
Windows Entertainment Pack build many people remember. Those are proprietary
products; the idea is not, and game rules are not copyrightable. This game has
its own name, code, art and scoring, is not a clone of any particular product,
and no page on this site describes it as one.

## Rules implemented

Pipes arrive in a queue you can see but not reorder — you place the next one,
you never choose it. Water starts at the source after a countdown and follows
connected openings one square at a time. A square the water has already passed
through is fixed; anything else can be overwritten at a small score penalty.
Each level needs a longer run and gives less time before the flow starts.
