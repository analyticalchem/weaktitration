# Titration Curve Explorer

An interactive teaching page for acid–base titration curves: a weak acid or weak base (up to three
proton sites) titrated with a strong base or strong acid, with the species in the flask shown at any
point along the curve. Plain HTML, CSS and JavaScript; no build step and no dependencies.

Open `index.html` in any modern browser, or serve the folder with any static server. Published at
https://analyticalchem.github.io/weaktitration/ (GitHub Pages, from the default branch, `/ (root)`).

## What it shows

- **Titration curve**: pH (0 to 14) against the volume of titrant added. Click or drag on the curve,
  move the slider, or type a volume to set the current point. Dashed guides mark each equivalence
  volume, dotted guides each half-equivalence volume, and dash-dot guides the pH = pK<sub>a</sub> levels.
- **Species in the flask**: moles of every form of the titrand (from the exact equilibrium fractions)
  and, when shown, the free OH⁻ and H₃O⁺ actually in solution, n = [ion] × V. A Linear / Log toggle on
  the bar axis makes the very small amounts visible.
- **Readouts**: pH and [H₃O⁺], every equivalence volume with its pH, the dominant species, the titrant
  added, and both water ions, with a status line naming the region of the curve.
- **Tables**: the curve's key points and the species at the current point, including the total
  titrant added and how much lies beyond the final equivalence point.
- **Student guide**: seven activities with Load buttons (also as chips in the controls), take-away
  questions, and an About the Model panel with the calculation.

## Modes

| Titrand | Titrant | Inputs |
|---|---|---|
| Weak acid (HA, H₂A, H₃A) | strong base, such as NaOH | pK<sub>a1</sub> … pK<sub>an</sub> |
| Weak base (B → BH⁺, BH₂²⁺, BH₃³⁺) | strong acid, such as HCl | pK<sub>b1</sub> … pK<sub>bn</sub> |

The Example menu supplies literature pK values at 25 °C for common acids and bases. Concentrations run
from 0.0001 to 1 M (the sliders move by powers of ten; a typing box takes exact values such as
`0.05` or `10 mM`).

## How the pH is calculated

For an *n*-protic system with acidity constants K<sub>a1</sub> … K<sub>an</sub>, the fraction that has
lost *j* protons is

    α_j = [H⁺]^(n−j) · K_a1 ··· K_aj / D,     D = Σ_k [H⁺]^(n−k) · K_a1 ··· K_ak

and electroneutrality of the diluted solution requires

    s_T·C_T + [H⁺] + C_A · Σ_j (z₀ − j)·α_j − K_w/[H⁺] = 0

where C<sub>A</sub> and C<sub>T</sub> are the diluted analytical concentrations of titrand and titrant,
s<sub>T</sub> = +1 for a strong-base titrant and −1 for a strong acid, and z₀ is the charge of the
fully protonated form (0 for H<sub>n</sub>A, +n for a base). The left-hand side is strictly increasing
in [H⁺], so a bisection in log [H⁺] finds the unique root at every volume, with no region-by-region
approximations. A weak base is the same system started from the deprotonated end, with
pK<sub>a</sub> = 14.00 − pK<sub>b</sub>. Activity coefficients are 1 and K<sub>w</sub> = 1.0 × 10⁻¹⁴ (25 °C).

## Files

```
index.html        page structure and text, including the student guide
css/styles.css    tokens, layout, components, themes, presentation mode
js/model.js       the chemistry (pure functions, no DOM)
js/page.js        page chrome: theme button, presentation mode, typing boxes
js/chart.js       the titration curve (canvas)
js/bars.js        the species bars (canvas)
js/main.js        wiring: controls, readouts, tables
old/              the earlier single-file version, kept for reference
```

## Accessibility and presentation

The page follows the analyticalchem house format and WCAG 2.1 AA: landmarks and headings, a skip link,
visible focus rings, native controls with labels, every drawn number also in text (readouts and
tables), tooltips that Escape dismisses, light and dark themes, and reflow to one column at 320 px.
The **Present** button (or Alt + Shift + P, or `?present=1` in the address) enlarges text, controls
and charts for a projector; Escape exits.

## Licence

MIT. See `LICENSE`.
